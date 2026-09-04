/**
 * B2BPortal — extracted from App.tsx
 * Handles quotations, dealers, and price lists for B2B/dealer users.
 */
import React, { useState, useEffect } from 'react';
import { confirmAction, confirmDelete } from '../lib/confirm';
import { odemeTakipli } from '../utils/siparis';
import { authFetch } from '../services/authFetch';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Download, Edit2, Eye,
  FilePlus, FileText, Globe, List, Plus, RefreshCw, Search,
  ShoppingBag, Trash2, Users, X,
} from 'lucide-react';
import {
  collection, doc, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc,
} from '../lib/dbClient';
import type { User } from 'firebase/auth';
import { db, auth } from '../firebase';
import type {
  UserRole, Lead, InventoryItem, Order,
  Quotation, PriceList, QuotationItem,
} from '../types';
import { cn } from '../lib/utils';
import { sortByCreatedAt } from '../utils/fsSort';
import { kurCevir } from '../utils/currency';
import { logFirestoreError as importedLogFirestoreError, OperationType } from '../utils/firebase';
import { exportOrderPDF } from '../utils/pdf';
import { syncShopify } from '../services/shopifyService';
import SortHeader from './SortHeader';
import ModuleHeader from './ModuleHeader';

// Lazy-loaded components (defined in App.tsx via React.lazy) — keep the same pattern
const QuotationForm   = React.lazy(() => import('./QuotationForm'));
const QuotationDetail = React.lazy(() => import('./QuotationDetail'));
const PriceListForm   = React.lazy(() => import('./PriceListForm'));

// ── Local helper ─────────────────────────────────────────────────────────────
function throwFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const info = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    userId: auth.currentUser?.uid,
  };
  console.error('Firestore Error:', info.error, '|', info.operationType, info.path);
  throw new Error(JSON.stringify(info));
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface B2BPortalProps {
  user: User | null;
  userRole: UserRole;
  leads: Lead[];
  inventory: InventoryItem[];
  orders?: Order[];
  currentT: Record<string, string>;
  currentLanguage: string;
  exchangeRates?: Record<string, number> | null;
}

// ── Component ─────────────────────────────────────────────────────────────────
const B2BPortal: React.FC<B2BPortalProps> = ({
  user, userRole, leads, inventory, orders: portalOrders = [],
  currentT, currentLanguage, exchangeRates,
}) => {
  // Fiyat listesi yönetimi yalnız personel (Admin/Manager/Sales). Dış roller (B2B/Dealer) fiyatları salt-okur — rbac.ts ile hizalı.
  const canManagePrices = userRole === 'Admin' || userRole === 'Manager' || userRole === 'Sales';
  const [b2bTab, setB2bTab] = useState<'quotations' | 'dealers' | 'pricelists' | 'komisyon'>('quotations');
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [dealers, setDealers] = useState<Record<string, unknown>[]>([]);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [isAddingPrice, setIsAddingPrice] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);
  const [selectedPriceList, setSelectedPriceList] = useState<PriceList | null>(null);
  const [isEditingQuotation, setIsEditingQuotation] = useState(false);
  const [isEditingPriceList, setIsEditingPriceList] = useState(false);
  const [isEditingCredit, setIsEditingCredit] = useState(false);
  const [dealerCurrency, setDealerCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [creditInfo, setCreditInfo] = useState({ limit: 500000, used: 200000 });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });
  const [sortConfigDealers, setSortConfigDealers] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [sortConfigPriceLists, setSortConfigPriceLists] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'productName', direction: 'asc' });
  const [isDealerModalOpen, setIsDealerModalOpen] = useState(false);
  const [editingDealer, setEditingDealer] = useState<Record<string, unknown> | null>(null);
  const [dealerForm, setDealerForm] = useState({ name: '', company: '', email: '', phone: '', taxId: '', creditLimit: 500000, priceTier: 'Dealer' as string, paymentTerms: '30', address: '' });
  const [dealerSearch, setDealerSearch] = useState('');
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifySyncStatus, setShopifySyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Bayi/kredi gostergelerinin para birimi bicimleyicisi. Tutarlar TL tutulur;
  // secili para birimine ceviri YALNIZ gercek kur varsa yapilir. Kur yoksa
  // uydurma yedek (eski `exchangeRates?.USD || 1`: TL rakamini '$' ile basip
  // ~38x sisiriyordu) yerine '—' gosterilir. TRY seciliyken kur gerekmez,
  // kurCevir tutari aynen dondurur — davranis degismez.
  const dcSym = dealerCurrency === 'TRY' ? '₺' : dealerCurrency === 'USD' ? '$' : '€';
  const dcFormat = (tutarTL: number): string => {
    const cevrilen = kurCevir(tutarTL, dealerCurrency, exchangeRates);
    if (cevrilen === null) return '—';
    return `${dcSym}${cevrilen.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;
  };

  useEffect(() => {
    if (!user || !userRole) return;
    const q = userRole === 'Admin' || userRole === 'Manager'
      ? collection(db, 'quotations')
      : query(collection(db, 'quotations'), where('customerEmail', '==', user?.email ?? ''));

    const unsubQuotes = onSnapshot(q, (snap) => {
      setQuotations(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Quotation))));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'quotations', auth.currentUser?.uid));

    const unsubPrices = onSnapshot(collection(db, 'priceLists'), (snap) => {
      setPriceLists(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as PriceList))));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'priceLists', auth.currentUser?.uid));

    const dealerQ = userRole === 'Admin' || userRole === 'Manager'
      ? query(collection(db, 'leads'), where('customerType', '==', 'Dealer'))
      : query(collection(db, 'leads'), where('email', '==', user?.email ?? ''));
    const unsubDealers = onSnapshot(dealerQ, (snap) => {
      setDealers(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    });

    const unsubCredit = onSnapshot(query(collection(db, 'leads'), where('email', '==', user?.email ?? '')), (snap) => {
      if (!snap.empty) {
        const leadData = snap.docs[0].data();
        setCreditInfo({ limit: leadData.creditLimit || 500000, used: leadData.creditUsed || 0 });
      }
    });

    return () => { unsubQuotes(); unsubPrices(); unsubCredit(); unsubDealers(); };
  }, [user?.email, userRole, user]);

  const handleSaveDealer = async () => {
    // Duplicate onleme (yalniz yeni bayi eklerken): VKN (normalize) -> case-
    // insensitive isim. PurchasingModule tedarikci deseniyle ayni oncelik sirasi.
    if (!editingDealer) {
      const normalizeVkn = (v?: string) => (v || '').replace(/\D/g, '');
      const vkn = normalizeVkn(dealerForm.taxId);
      const nameKey = dealerForm.name.trim().toLowerCase();
      const dup = dealers.find(d => {
        const dVkn = normalizeVkn(d.taxId as string | undefined);
        if (vkn && dVkn === vkn) return true;
        return ((d.name as string) || '').trim().toLowerCase() === nameKey;
      });
      if (dup) {
        window.alert(
          currentLanguage === 'tr'
            ? `Bu VKN/isimde bir bayi zaten var: "${dup.name as string}". Mevcut kaydı düzenleyin.`
            : `A dealer with this tax ID/name already exists: "${dup.name as string}". Please edit the existing record.`
        );
        return;
      }
    }
    try {
      const data = { ...dealerForm, customerType: 'Dealer', status: 'Active', updatedAt: new Date() };
      if (editingDealer) {
        await updateDoc(doc(db, 'leads', editingDealer.id as string), data);
      } else {
        await addDoc(collection(db, 'leads'), { ...data, createdAt: new Date() });
      }
      setIsDealerModalOpen(false);
      setEditingDealer(null);
      setDealerForm({ name: '', company: '', email: '', phone: '', taxId: '', creditLimit: 500000, priceTier: 'Dealer', paymentTerms: '30', address: '' });
    } catch (e) { console.error('[handleSaveDealer]', e); }
  };

  const filteredDealers = dealers
    .filter(d =>
      (d.name as string || '').toLowerCase().includes(dealerSearch.toLowerCase()) ||
      (d.company as string || '').toLowerCase().includes(dealerSearch.toLowerCase()) ||
      (d.email as string || '').toLowerCase().includes(dealerSearch.toLowerCase()),
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
      q.id.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    .sort((a, b) => {
      const aValue = a[sortConfig.key as keyof Quotation];
      const bValue = b[sortConfig.key as keyof Quotation];
      if (aValue! < bValue!) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue! > bValue!) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const handleConvertToOrder = async (q: Quotation) => {
    const ok = await confirmAction({
      title: currentT.confirm_convert_to_order || 'Siparişe Dönüştür',
      message: currentT.confirm_convert_to_order_msg || 'Bu teklifi Shopify siparişine dönüştürmek istediğinize emin misiniz?',
      confirmLabel: currentLanguage === 'tr' ? 'Dönüştür' : 'Convert',
      // Silme değil, dış sisteme yazan geri alınamaz bir işlem — 'warning'.
      variant: 'warning',
    });
    if (!ok) return;
    setShopifySyncing(true);
        try {
          const response = await authFetch('/api/shopify/draft-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerName: q.customerName,
              email: q.customerEmail,
              note: `Converted from Quotation #${q.id}. Notes: ${q.notes || ''}`,
              lineItems: (q.lineItems || q.items || []).map((item: QuotationItem) => ({
                title: item.name, sku: item.sku,
                // KDV dahil (brüt) fiyat — önce KDV-hariç gönderiliyordu, sipariş toplamı eksikti.
                price: Math.round((Number(item.price) || 0) * (1 + (Number(item.vatRate) || 0) / 100) * 100) / 100,
                quantity: item.quantity,
              })),
            }),
          });
          if (!response.ok) throw new Error('Shopify API error');
          await updateDoc(doc(db, 'quotations', q.id), { status: 'Converted' });
          setShopifySyncStatus({ type: 'success', message: 'Teklif başarıyla Shopify siparişine dönüştürüldü.' });
        } catch (err) {
          setShopifySyncStatus({ type: 'error', message: err instanceof Error ? err.message : 'Dönüştürme hatası.' });
    } finally {
      setShopifySyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {shopifySyncStatus && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={cn(
              'fixed top-4 right-4 z-[10000] p-4 rounded-2xl shadow-2xl flex items-center gap-3',
              shopifySyncStatus.type === 'success' ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-red-50 text-red-800 border border-red-100',
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
            <button onClick={() => { setEditingDealer(null); setDealerForm({ name: '', company: '', email: '', phone: '', taxId: '', creditLimit: 500000, priceTier: 'Dealer', paymentTerms: '30', address: '' }); setIsDealerModalOpen(true); }} className="apple-button-primary">
              <Plus className="w-4 h-4" /> {currentLanguage === 'tr' ? 'Yeni Bayi' : 'New Dealer'}
            </button>
          ) : b2bTab === 'pricelists' && canManagePrices ? (
            <button onClick={() => setIsAddingPrice(true)} className="apple-button-primary">
              <Plus className="w-4 h-4" /> {currentT.new_price_list}
            </button>
          ) : null
        }
      />

      {/* Sub-tabs */}
      <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
        <div className="flex items-center gap-1 w-max border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          {([
            { id: 'quotations', label: currentLanguage === 'tr' ? 'Teklifler' : 'Quotations', icon: FileText },
            { id: 'dealers', label: currentLanguage === 'tr' ? 'Bayiler' : 'Dealers', icon: Users },
            { id: 'pricelists', label: currentLanguage === 'tr' ? 'Fiyat Listeleri' : 'Price Lists', icon: List },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setB2bTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap -mb-px ${b2bTab === t.id ? 'border-brand text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dealer modal */}
      {isDealerModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="apple-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">{editingDealer ? (currentLanguage === 'tr' ? 'Bayi Düzenle' : 'Edit Dealer') : (currentLanguage === 'tr' ? 'Yeni Bayi' : 'New Dealer')}</h3>
              <button onClick={() => setIsDealerModalOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Ad Soyad' : 'Full Name'}</label>
                  <input className="apple-input w-full" value={dealerForm.name} onChange={e => setDealerForm(f => ({ ...f, name: e.target.value }))} placeholder="Ahmet Yılmaz" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Firma' : 'Company'}</label>
                  <input className="apple-input w-full" value={dealerForm.company} onChange={e => setDealerForm(f => ({ ...f, company: e.target.value }))} placeholder="ABC Ticaret Ltd." /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">E-posta</label>
                  <input className="apple-input w-full" type="email" value={dealerForm.email} onChange={e => setDealerForm(f => ({ ...f, email: e.target.value }))} placeholder="bayi@firma.com" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Telefon' : 'Phone'}</label>
                  <input className="apple-input w-full" value={dealerForm.phone} onChange={e => setDealerForm(f => ({ ...f, phone: e.target.value }))} placeholder="+90 555 000 00 00" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Vergi No' : 'Tax ID'}</label>
                  <input className="apple-input w-full" value={dealerForm.taxId} onChange={e => setDealerForm(f => ({ ...f, taxId: e.target.value }))} placeholder="1234567890" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Fiyat Kademesi' : 'Price Tier'}</label>
                  <select className="apple-input w-full" value={dealerForm.priceTier} onChange={e => setDealerForm(f => ({ ...f, priceTier: e.target.value }))}>
                    <option value="Dealer">Bayi</option>
                    <option value="B2B Premium">B2B Premium</option>
                    <option value="B2B Standard">B2B Standard</option>
                    <option value="Retail">Perakende</option>
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Kredi Limiti (₺)' : 'Credit Limit (₺)'}</label>
                  <input className="apple-input w-full" type="number" value={dealerForm.creditLimit} onChange={e => setDealerForm(f => ({ ...f, creditLimit: Number(e.target.value) }))} /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Ödeme Vadesi (gün)' : 'Payment Terms (days)'}</label>
                  <input className="apple-input w-full" type="number" value={dealerForm.paymentTerms} onChange={e => setDealerForm(f => ({ ...f, paymentTerms: e.target.value }))} /></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage === 'tr' ? 'Adres' : 'Address'}</label>
                <textarea className="apple-input w-full resize-none" rows={2} value={dealerForm.address} onChange={e => setDealerForm(f => ({ ...f, address: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveDealer} className="apple-button-primary flex-1 justify-center">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              <button onClick={() => setIsDealerModalOpen(false)} className="apple-button-secondary flex-1 justify-center">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B] pointer-events-none" />
        <input
          type="text"
          placeholder={b2bTab === 'dealers' ? (currentLanguage === 'tr' ? 'Bayi ara...' : 'Search dealer...') : currentT.search_quote}
          className="apple-input pl-10 w-full"
          value={b2bTab === 'dealers' ? dealerSearch : searchTerm}
          onChange={(e) => b2bTab === 'dealers' ? setDealerSearch(e.target.value) : setSearchTerm(e.target.value)}
        />
      </div>

      {isAddingPrice && <PriceListForm isOpen={isAddingPrice} onClose={() => setIsAddingPrice(false)} inventory={inventory} t={currentT} />}
      {isEditingPriceList && selectedPriceList && (
        <PriceListForm isOpen={isEditingPriceList} onClose={() => { setIsEditingPriceList(false); setSelectedPriceList(null); }} inventory={inventory} initialData={selectedPriceList} t={currentT} />
      )}
      {selectedQuotation && !isEditingQuotation && (
        <QuotationDetail isOpen={!!selectedQuotation} quotation={selectedQuotation} onClose={() => setSelectedQuotation(null)}
          onEdit={(q) => { setSelectedQuotation(q); setIsEditingQuotation(true); }}
          onConvertToOrder={handleConvertToOrder} t={currentT} />
      )}

      {/* Dealers Tab */}
      {b2bTab === 'dealers' && (
        <div className="space-y-4">
          {/* KPI row */}
          {(() => {
            const totalCredit = dealers.reduce((s, d) => s + (d.creditLimit as number || 0), 0);
            const CurrencyToggle = () => (
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {(['TRY', 'USD', 'EUR'] as const).map(c => (
                  <button key={c} onClick={() => setDealerCurrency(c)}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${dealerCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                    {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                  </button>
                ))}
              </div>
            );
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="apple-card p-4"><p className="text-2xl font-bold text-brand">{dealers.length}</p><p className="text-xs text-gray-500 mt-1">{currentLanguage === 'tr' ? 'Toplam Bayi' : 'Total Dealers'}</p></div>
                <div className="apple-card p-4"><p className="text-2xl font-bold text-green-600">{dealers.filter(d => d.status === 'Active').length}</p><p className="text-xs text-gray-500 mt-1">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</p></div>
                <div className="apple-card p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Toplam Kredi' : 'Total Credit'}</p><CurrencyToggle /></div>
                  <p className="text-2xl font-bold text-blue-600">{dcFormat(totalCredit)}</p>
                </div>
                <div className="apple-card p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Teklif Toplamı' : 'Quote Total'}</p><CurrencyToggle /></div>
                  <p className="text-2xl font-bold text-purple-600">
                    {/* q.total alanı yok → totalAmount, yoksa lineItems'tan hesapla (önce hep ₺0 gösteriyordu) */}
                    {dcFormat(quotations.reduce((s, q) => s + (Number(q.totalAmount) || ((q.lineItems || q.items || []) as QuotationItem[]).reduce((a, it) => a + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0)), 0))}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Credit limit alerts */}
          {dealers.length > 0 && (() => {
            const overLimit = dealers.filter(d => {
              const limit = (d.creditLimit as number) || 0;
              if (!limit) return false;
              const usage = portalOrders.filter(o => (o.customerName === (d.name as string) || o.customerEmail === (d.email as string)) && o.status !== 'Cancelled' && !o.paid && odemeTakipli(o)).reduce((s, o) => s + (o.totalPrice || 0), 0);
              return usage > limit;
            });
            if (overLimit.length === 0) return null;
            return (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-red-800">{overLimit.length} {currentLanguage === 'tr' ? 'bayi kredi limitini aştı' : 'dealer(s) over credit limit'}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {overLimit.map(d => (<span key={d.id as string} className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{d.name as string}</span>))}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="apple-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[560px] apple-table">
                <thead><tr>
                  <SortHeader label={currentLanguage === 'tr' ? 'Bayi / Firma' : 'Dealer / Company'} sortKey="name" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                  <SortHeader label="E-posta" sortKey="email" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                  <SortHeader label={currentLanguage === 'tr' ? 'Telefon' : 'Phone'} sortKey="phone" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden md:table-cell" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Kademe' : 'Tier'} sortKey="priceTier" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden sm:table-cell" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Kredi Limiti' : 'Credit Limit'} sortKey="creditLimit" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden lg:table-cell" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Vade' : 'Terms'} sortKey="paymentTerms" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden lg:table-cell" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Durum' : 'Status'} sortKey="status" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                  <th className="text-right px-4 py-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{currentLanguage === 'tr' ? 'İşlem' : 'Actions'}</th>
                </tr></thead>
                <tbody>
                  {filteredDealers.map(d => (
                    <tr key={d.id as string}>
                      <td><p className="font-semibold">{d.name as string}</p><p className="text-xs text-gray-400">{d.company as string}</p></td>
                      <td className="text-gray-500">{d.email as string}</td>
                      <td className="hidden md:table-cell text-gray-500">{d.phone as string}</td>
                      <td className="hidden sm:table-cell"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">{d.priceTier as string || 'Dealer'}</span></td>
                      <td className="hidden lg:table-cell font-semibold">{dcFormat((d.creditLimit as number) || 0)}</td>
                      <td className="hidden lg:table-cell text-gray-500">{d.paymentTerms as string || '30'} {currentLanguage === 'tr' ? 'gün' : 'days'}</td>
                      <td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.status === 'Active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{d.status as string || 'Active'}</span></td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditingDealer(d); setDealerForm({ name: d.name as string || '', company: d.company as string || '', email: d.email as string || '', phone: d.phone as string || '', taxId: d.taxId as string || '', creditLimit: d.creditLimit as number || 500000, priceTier: d.priceTier as string || 'Dealer', paymentTerms: d.paymentTerms as string || '30', address: d.address as string || '' }); setIsDealerModalOpen(true); }} className="action-btn-edit"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={async () => { if (!await confirmDelete(undefined, currentLanguage === 'tr' ? 'tr' : 'en')) return; await deleteDoc(doc(db, 'leads', d.id as string)); }} className="action-btn-delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredDealers.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-gray-400 text-sm">{dealers.length === 0 ? (currentLanguage === 'tr' ? 'Henüz bayi eklenmedi.' : 'No dealers yet.') : (currentLanguage === 'tr' ? 'Arama sonucu bulunamadı.' : 'No results found.')}</p>
                        {dealers.length === 0 && (<button onClick={() => { setEditingDealer(null); setDealerForm({ name: '', company: '', email: '', phone: '', taxId: '', creditLimit: 500000, priceTier: 'Dealer', paymentTerms: '30', address: '' }); setIsDealerModalOpen(true); }} className="apple-button-primary text-sm px-5 py-2 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Bayi Ekle' : 'Add Dealer'}</button>)}
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
            <table className="min-w-[560px] apple-table">
              <thead><tr>
                <SortHeader label={currentT.product} sortKey="productName" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                <SortHeader label="Retail" sortKey="prices.Retail" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right" />
                <SortHeader label="B2B Standard" sortKey="prices.B2B Standard" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right hidden sm:table-cell" />
                <SortHeader label="B2B Premium" sortKey="prices.B2B Premium" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right hidden sm:table-cell" />
                <SortHeader label={currentLanguage === 'tr' ? 'Bayi' : 'Dealer'} sortKey="prices.Dealer" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right" />
                <th className="text-right px-4 py-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{currentT.actions || 'İşlem'}</th>
              </tr></thead>
              <tbody>
                {priceLists
                  .sort((a, b) => {
                    const getVal = (pl: PriceList, key: string): string | number => {
                      if (key.startsWith('prices.')) { const tier = key.slice(7); return (pl.prices as Record<string, number>)?.[tier] ?? 0; }
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
                      <td><p className="font-semibold">{(pl.productName as string) || (pl.itemName as string)}</p><p className="text-xs text-gray-400">{pl.sku as string}</p></td>
                      <td className="text-right font-semibold">{(pl.prices?.['Retail'] ?? 0).toLocaleString('tr-TR')} {(pl.currency as string) || '₺'}</td>
                      <td className="text-right text-gray-500 hidden sm:table-cell">{(pl.prices?.['B2B Standard'] ?? 0).toLocaleString('tr-TR')}</td>
                      <td className="text-right text-gray-500 hidden sm:table-cell">{(pl.prices?.['B2B Premium'] ?? 0).toLocaleString('tr-TR')}</td>
                      <td className="text-right text-brand font-bold">{(pl.prices?.['Dealer'] ?? 0).toLocaleString('tr-TR')}</td>
                      <td><div className="flex items-center justify-end gap-1">
                        {canManagePrices ? (<>
                          <button onClick={() => { setSelectedPriceList(pl); setIsEditingPriceList(true); }} className="action-btn-edit"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={async () => { if (!await confirmDelete(undefined, currentLanguage === 'tr' ? 'tr' : 'en')) return; await deleteDoc(doc(db, 'priceLists', pl.id)); }} className="action-btn-delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>) : <span className="text-[10px] text-gray-300">—</span>}
                      </div></td>
                    </tr>
                  ))}
                {priceLists.length === 0 && (<tr><td colSpan={6} className="text-center py-12"><div className="flex flex-col items-center gap-3"><p className="text-gray-400 text-sm">{currentLanguage === 'tr' ? 'Henüz fiyat listesi eklenmedi.' : 'No price lists yet.'}</p>{canManagePrices && (<button onClick={() => setIsAddingPrice(true)} className="apple-button-primary text-sm px-5 py-2 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Fiyat Listesi Ekle' : 'Add Price List'}</button>)}</div></td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quotations Tab */}
      {b2bTab === 'quotations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="apple-card p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">{currentT.active_quotations}</h3>
                <span className="text-xs text-[#86868B] font-medium">{filteredQuotations.length} {currentT.items || 'kayıt'}</span>
              </div>
              <div className="overflow-x-auto -mx-2">
                {/* 520: lg'de dar kolonda (≈440px) 560 fazla scroll üretiyordu;
                    6 kolonlu tablo için 520 alt sınır (code-review dengesi). */}
                <table className="min-w-[520px] w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <SortHeader label={currentT.customer || 'Müşteri'} sortKey="customerName" currentSort={sortConfig} onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="py-2 px-2" />
                    <SortHeader label="Ref No" sortKey="id" currentSort={sortConfig} onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="py-2 px-2 hidden md:table-cell" />
                    <SortHeader label={currentT.amount || 'Tutar'} sortKey="totalAmount" currentSort={sortConfig} onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="py-2 px-2" />
                    <SortHeader label={currentT.status || 'Durum'} sortKey="status" currentSort={sortConfig} onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="py-2 px-2" />
                    <SortHeader label={currentT.date || 'Tarih'} sortKey="createdAt" currentSort={sortConfig} onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="py-2 px-2 hidden md:table-cell" />
                    <th className="py-2 px-2 text-[#86868B] font-semibold text-xs text-right">{currentT.actions || 'İşlem'}</th>
                  </tr></thead>
                  <tbody>
                    {filteredQuotations.map((q) => (
                      <tr key={q.id} onClick={() => setSelectedQuotation(q)} className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer group">
                        <td className="py-2.5 px-2"><p className="font-semibold text-[#1D1D1F] truncate max-w-[140px]">{q.customerName}</p><p className="text-[10px] text-[#86868B]">{q.items?.length || 0} {currentT.items || 'ürün'}</p></td>
                        <td className="py-2.5 px-2 font-mono text-xs text-[#86868B] hidden md:table-cell">#{q.id.slice(0, 8)}</td>
                        <td className="py-2.5 px-2 font-bold text-[#1D1D1F] whitespace-nowrap">{(q.totalAmount ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {q.currency || 'TL'}</td>
                        <td className="py-2.5 px-2">
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap', q.status === 'approved' ? 'bg-green-100 text-green-600' : q.status === 'Converted to Order' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600')}>
                            {q.status === 'approved' ? currentT.approved : q.status === 'Converted to Order' ? currentT.converted : currentT.pending}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-xs text-[#86868B] hidden md:table-cell">{(q.createdAt as { toDate?: () => Date })?.toDate ? (q.createdAt as { toDate: () => Date }).toDate().toLocaleDateString('tr-TR') : '—'}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); setSelectedQuotation(q); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-[#86868B] hover:text-blue-600 transition-colors" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye className="w-3.5 h-3.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); exportOrderPDF(q as unknown as Record<string, unknown>, currentT); }} className="p-1.5 rounded-lg hover:bg-green-50 text-[#86868B] hover:text-green-600 transition-colors" title={currentT.download_pdf || 'PDF İndir'}><Download className="w-3.5 h-3.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); setSelectedQuotation(q); setIsEditingQuotation(true); }} className="p-1.5 rounded-lg hover:bg-brand/10 text-[#86868B] hover:text-brand transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); void (async () => { if (!(await confirmDelete(undefined, currentLanguage === 'tr' ? 'tr' : 'en'))) return; try { await deleteDoc(doc(db, 'quotations', q.id)); } catch (error) { throwFirestoreError(error, OperationType.DELETE, `quotations/${q.id}`); } })(); }} className="p-1.5 rounded-lg hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredQuotations.length === 0 && (<tr><td colSpan={6} className="text-center py-8 text-[#86868B] text-sm">{currentT.no_records}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="apple-card p-6 bg-brand text-white">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold">{currentT.credit_limit}</h3>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 bg-white/20 rounded-lg p-0.5">
                    {(['TRY', 'USD', 'EUR'] as const).map(c => (<button key={c} onClick={() => setDealerCurrency(c)} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${dealerCurrency === c ? 'bg-white text-brand shadow-sm' : 'text-white/70 hover:text-white'}`}>{c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}</button>))}
                  </div>
                  <button onClick={() => setIsEditingCredit(true)} className="text-xs underline opacity-80 hover:opacity-100">{currentT.edit}</button>
                </div>
              </div>
              {isEditingCredit ? (
                <div className="space-y-3">
                  <input type="number" value={creditInfo.limit} onChange={(e) => setCreditInfo({ ...creditInfo, limit: Number(e.target.value) })} className="w-full bg-white/20 border border-white/30 rounded-xl px-3 py-2 text-white outline-none focus:bg-white/30" placeholder={currentT.credit_limit_label} />
                  <div className="flex gap-2">
                    <button onClick={async () => { const lead = leads.find(l => l.email === user?.email); if (lead) { await updateDoc(doc(db, 'leads', lead.id), { creditLimit: creditInfo.limit }); } setIsEditingCredit(false); }} className="flex-1 bg-white text-brand py-2 rounded-xl text-xs font-bold">{currentT.save}</button>
                    <button onClick={() => setIsEditingCredit(false)} className="flex-1 bg-white/20 text-white py-2 rounded-xl text-xs font-bold">{currentT.cancel}</button>
                  </div>
                </div>
              ) : (<>
                <p className="text-3xl font-bold mb-4">{dcFormat(creditInfo.limit)}</p>
                <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden mb-2">
                  <div className={cn('h-full', (creditInfo.used / creditInfo.limit) > 0.8 ? 'bg-red-500' : (creditInfo.used / creditInfo.limit) > 0.5 ? 'bg-yellow-400' : 'bg-white')} style={{ width: `${Math.min(100, (creditInfo.used / creditInfo.limit) * 100)}%` }} />
                </div>
                <p className="text-xs opacity-80">{currentT.used_limit}: {dcFormat(creditInfo.used)} ({Math.round((creditInfo.used / creditInfo.limit) * 100)}%)</p>
                {creditInfo.used > creditInfo.limit && <p className="text-xs font-bold mt-2 text-red-200">⚠️ {currentT.over_limit}</p>}
              </>)}
            </div>

            <div className="apple-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0"><ShoppingBag className="w-5 h-5 text-green-600" /></div>
                <div><h3 className="text-sm font-bold">Shopify Entegrasyonu</h3><p className="text-[11px] text-[#86868B]">Ürün ve sipariş senkronizasyonu</p></div>
              </div>
              {shopifySyncStatus && (<div className={cn('text-xs px-3 py-2 rounded-xl mb-3 font-medium', shopifySyncStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')}>{shopifySyncStatus.message}</div>)}
              <button onClick={async () => { setShopifySyncing(true); setShopifySyncStatus(null); try { const result = await syncShopify(); setShopifySyncStatus({ type: 'success', message: `${result?.products?.length ?? 0} ürün, ${result?.orders?.length ?? 0} sipariş senkronize edildi.` }); } catch (err) { setShopifySyncStatus({ type: 'error', message: err instanceof Error ? err.message : 'Shopify bağlantısı kurulamadı.' }); } finally { setShopifySyncing(false); } }} disabled={shopifySyncing}
                className={cn('w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2', shopifySyncing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white active:scale-95')}>
                <RefreshCw className={cn('w-3.5 h-3.5', shopifySyncing && 'animate-spin')} />
                {shopifySyncing ? 'Senkronize ediliyor...' : 'Shopify Senkronize Et'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreatingQuote && (<QuotationForm isOpen={isCreatingQuote} onClose={() => setIsCreatingQuote(false)} leads={leads} inventory={inventory} t={currentT} />)}
      {isEditingQuotation && selectedQuotation && (<QuotationForm isOpen={isEditingQuotation} onClose={() => { setIsEditingQuotation(false); setSelectedQuotation(null); }} leads={leads} inventory={inventory} initialData={selectedQuotation} t={currentT} />)}

    </div>
  );
};

export default B2BPortal;
