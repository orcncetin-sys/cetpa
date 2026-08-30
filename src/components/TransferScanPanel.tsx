/**
 * TransferScanPanel.tsx — QR-tabanlı konum-bazlı stok transferi.
 *
 * Akış: Kaynak lokasyon QR → Ürün barkodu → Miktar → Hedef lokasyon QR → Transfer.
 * QR değeri src/lib/locationQr.ts biçiminde (CETPA-LOC:type:id); okunan id
 * warehouses/vehicles içinde çözülür. Ürün barkodu inventory'de sku ile eşleşir.
 * Transfer atomik olarak POST /api/logistics/transfer'e gider.
 */
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { QrCode, Package, ArrowRightLeft, X, Check, Warehouse as WarehouseIcon, Truck } from 'lucide-react';
const BarcodeScanner = React.lazy(() => import('./BarcodeScanner'));
import ModuleHeader from './ModuleHeader';
import { parseLocationQr } from '../lib/locationQr';
import { transferStock, getLocationQty, type LocationRef } from '../services/logisticsService';
import type { InventoryItem, Warehouse, Vehicle, LocationStock } from '../types';

interface Props {
  currentLanguage: 'tr' | 'en';
  inventory: InventoryItem[];
  warehouses: Warehouse[];
  vehicles: Vehicle[];
  locationStocks: LocationStock[];
  hasFullAccess: (tab: string) => boolean;
  toast: (msg: string, type?: string) => void;
}

type ScanTarget = 'source' | 'dest' | 'product' | null;

export default function TransferScanPanel({
  currentLanguage, inventory, warehouses, vehicles, locationStocks, hasFullAccess, toast,
}: Props) {
  const tr = currentLanguage === 'tr';
  const [scanTarget, setScanTarget] = useState<ScanTarget>(null);
  const [source, setSource] = useState<LocationRef | null>(null);
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [product, setProduct] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  // Okunan QR'ı warehouses/vehicles içinde çözer → LocationRef döner.
  const resolveLocation = (raw: string): LocationRef | null => {
    const parsed = parseLocationQr(raw);
    if (!parsed) return null;
    if (parsed.type === 'warehouse') {
      const w = warehouses.find(x => x.id === parsed.id);
      return w ? { type: 'warehouse', id: w.id, name: w.name } : null;
    }
    const v = vehicles.find(x => x.id === parsed.id);
    return v ? { type: 'vehicle', id: v.id, name: v.plate } : null;
  };

  const resolveProduct = (raw: string): InventoryItem | null => {
    const q = raw.trim().toLowerCase();
    return inventory.find(i =>
      (i.sku || '').toLowerCase() === q ||
      String((i as unknown as { barcode?: string }).barcode || '').toLowerCase() === q ||
      i.id === raw.trim(),
    ) ?? null;
  };

  const handleScan = (raw: string) => {
    const target = scanTarget;
    setScanTarget(null);
    if (target === 'product') {
      const p = resolveProduct(raw);
      if (p) setProduct(p);
      else toast(tr ? `Ürün bulunamadı: ${raw}` : `Product not found: ${raw}`, 'error');
      return;
    }
    const loc = resolveLocation(raw);
    if (!loc) {
      toast(tr ? 'Geçersiz lokasyon QR kodu (bu depo/araç sistemde yok).' : 'Invalid location QR (unknown warehouse/vehicle).', 'error');
      return;
    }
    if (target === 'source') setSource(loc);
    else if (target === 'dest') setDest(loc);
  };

  const sourceQty = source && product ? getLocationQty(locationStocks, source.type, source.id, product.id) : 0;
  const qtyNum = Math.floor(Number(quantity) || 0);
  const canSubmit = !!source && !!dest && !!product && qtyNum > 0 && qtyNum <= sourceQty
    && !(source.type === dest.type && source.id === dest.id) && hasFullAccess('lojistik');

  const handleSubmit = async () => {
    if (!source || !dest || !product) return;
    setSubmitting(true);
    try {
      const r = await transferStock({
        productId: product.id, sku: product.sku, productName: product.name,
        quantity: qtyNum, from: source, to: dest,
      });
      if (r.success) {
        toast(tr ? `Transfer tamam: ${qtyNum} ${product.name} · ${source.name} → ${dest.name}` : `Transferred ${qtyNum} ${product.name}`, 'success');
        setSource(null); setDest(null); setProduct(null); setQuantity('1');
      } else {
        toast(r.error || (tr ? 'Transfer başarısız.' : 'Transfer failed.'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const LocCard = ({ label, loc, target }: { label: string; loc: LocationRef | null; target: ScanTarget }) => (
    <div className="apple-card p-4">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      {loc ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {loc.type === 'warehouse' ? <WarehouseIcon className="w-4 h-4 text-brand shrink-0" /> : <Truck className="w-4 h-4 text-brand shrink-0" />}
            <span className="font-bold text-gray-900 truncate">{loc.name}</span>
          </div>
          <button onClick={() => target === 'source' ? setSource(null) : setDest(null)} className="p-2.5 -m-1.5 rounded-lg text-gray-300 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button onClick={() => setScanTarget(target)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-semibold text-gray-500 hover:border-brand hover:text-brand transition-colors">
          <QrCode className="w-4 h-4" />{tr ? 'QR Tara' : 'Scan QR'}
        </button>
      )}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <ModuleHeader
        title={tr ? '📦 QR Transfer (Depo/Araç)' : '📦 QR Transfer (Warehouse/Vehicle)'}
        subtitle={tr ? 'Kaynak QR → Ürün → Miktar → Hedef QR ile depolar ve araçlar arası stok transferi.' : 'Scan source → product → quantity → destination to move stock between warehouses and vehicles.'}
        icon={ArrowRightLeft}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LocCard label={tr ? 'Kaynak (nereden)' : 'Source (from)'} loc={source} target="source" />
        <LocCard label={tr ? 'Hedef (nereye)' : 'Destination (to)'} loc={dest} target="dest" />
      </div>

      {/* Ürün */}
      <div className="apple-card p-4">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{tr ? 'Ürün' : 'Product'}</p>
        {product ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="w-4 h-4 text-brand shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">{product.name}</p>
                <p className="text-[10px] text-gray-400">{product.sku}{source ? ` · ${tr ? 'kaynak stok' : 'source qty'}: ${sourceQty}` : ''}</p>
              </div>
            </div>
            <button onClick={() => setProduct(null)} className="p-2.5 -m-1.5 rounded-lg text-gray-300 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="space-y-2">
            <button onClick={() => setScanTarget('product')} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-semibold text-gray-500 hover:border-brand hover:text-brand transition-colors">
              <QrCode className="w-4 h-4" />{tr ? 'Ürün Barkodu Tara' : 'Scan Product Barcode'}
            </button>
            <select value="" onChange={e => { const p = inventory.find(i => i.id === e.target.value); if (p) setProduct(p); }} className="apple-input w-full text-sm">
              <option value="">{tr ? 'veya listeden seç…' : 'or pick from list…'}</option>
              {inventory.slice(0, 500).map(i => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Miktar */}
      <div className="apple-card p-4">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{tr ? 'Miktar' : 'Quantity'}</p>
        <input type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} className="apple-input w-full" />
        {source && product && qtyNum > sourceQty && (
          <p className="text-[11px] text-red-500 mt-1.5">{tr ? `Kaynak lokasyonda yeterli stok yok (mevcut: ${sourceQty}).` : `Not enough stock at source (available: ${sourceQty}).`}</p>
        )}
      </div>

      {source && dest && source.type === dest.type && source.id === dest.id && (
        <p className="text-sm text-amber-600 text-center">{tr ? 'Kaynak ve hedef aynı olamaz.' : 'Source and destination must differ.'}</p>
      )}

      <button onClick={() => void handleSubmit()} disabled={!canSubmit || submitting} className="apple-button-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40">
        {submitting ? '…' : <><Check className="w-4 h-4" />{tr ? 'Transfer Et' : 'Transfer'}</>}
      </button>

      <React.Suspense fallback={null}>
        <BarcodeScanner
        isOpen={scanTarget !== null}
        onClose={() => setScanTarget(null)}
        onScan={handleScan}
        currentLanguage={currentLanguage}
        title={scanTarget === 'product' ? (tr ? 'Ürün Barkodu' : 'Product Barcode') : (tr ? 'Lokasyon QR' : 'Location QR')}
        placeholder={scanTarget === 'product' ? (tr ? 'SKU / barkod' : 'SKU / barcode') : (tr ? 'Depo/araç QR' : 'Warehouse/vehicle QR')}
        />
      </React.Suspense>
    </motion.div>
  );
}
