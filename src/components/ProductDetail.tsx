import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Edit2, Package, Tag, Layers, DollarSign, History, TrendingUp, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import ProductForm from './ProductForm';
import { format } from 'date-fns';

import { InventoryItem } from '../types';

/** Hem Cetpa şeması hem normalize edilmiş Mikro hareketi buraya oturur. */
interface InventoryMovement {
  id: string;
  productId?: string;
  productName?: string;
  sku?: string;
  type: 'in' | 'out';
  quantity: number;
  reason?: string;
  notes?: string;
  timestamp?: unknown;
  date?: string;
  birimFiyat?: number;   // KDV hariç birim fiyat (Mikro hareketinden türetilir)
}

interface ProductDetailProps {
  product: InventoryItem;
  onClose: () => void;
  /** InventoryView'da normalize edilmiş TÜM hareketler — burada bu ürüne göre süzülür. */
  movements?: InventoryMovement[];
}

const tl = (n: number) => `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date };
  if (typeof t.toDate === 'function') { try { return t.toDate(); } catch { /* düş */ } }
  const d = new Date(ts as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function ProductDetail({ product, onClose, movements = [] }: ProductDetailProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (!product) return null;

  // Bu ürünün hareketleri: productId VEYA SKU eşleşmesi (Mikro satırları SKU ile gelir).
  const urunHareketleri = movements
    .filter(m => (m.productId && m.productId === product.id) || (m.sku && m.sku === product.sku))
    .sort((a, b) => (toDate(b.timestamp)?.getTime() ?? 0) - (toDate(a.timestamp)?.getTime() ?? 0));

  // Son/ortalama satış fiyatı — 'out' (satış) hareketlerinin KDV hariç birim fiyatından.
  const satisHareketleri = urunHareketleri.filter(m => m.type === 'out' && (m.birimFiyat ?? 0) > 0);
  const sonSatisFiyati = satisHareketleri[0]?.birimFiyat ?? 0;
  const ortSatisFiyati = satisHareketleri.length
    ? satisHareketleri.reduce((s, m) => s + (m.birimFiyat || 0) * (m.quantity || 0), 0) /
      satisHareketleri.reduce((s, m) => s + (m.quantity || 0), 0)
    : 0;

  const vatRate = Number((product as unknown as { vatRate?: number }).vatRate ?? 0);
  const satisFiyati = product.prices?.['Retail'] || product.price || 0;
  const loading = false;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand/10 rounded-2xl">
              <Package className="w-6 h-6 text-brand" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{product.name}</h2>
              <p className="text-sm text-gray-500">SKU: {product.sku}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600"
              title="Düzenle"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2" />
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Mevcut Stok', value: String(product.stockLevel), note: '', icon: Layers, color: product.stockLevel <= product.lowStockThreshold ? 'text-red-600' : 'text-green-600', bg: product.stockLevel <= product.lowStockThreshold ? 'bg-red-50' : 'bg-green-50' },
              { label: 'Kritik Eşik', value: String(product.lowStockThreshold), note: '', icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50' },
              { label: 'Maliyet', value: tl(Number(product.costPrice) || 0), note: 'KDV hariç', icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Satış Fiyatı', value: tl(satisFiyati), note: satisFiyati > 0 ? 'KDV hariç' : 'tanımsız', icon: TrendingUp, color: 'text-brand', bg: 'bg-brand/5' },
            ].map((stat, i) => (
              <div key={i} className={cn("p-4 rounded-2xl border border-transparent transition-all", stat.bg)}>
                <div className="flex items-center gap-2 mb-1">
                  <stat.icon className={cn("w-3.5 h-3.5", stat.color)} />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className={cn("text-xl font-black", stat.color)}>{stat.value}</p>
                {stat.note && <p className="text-[10px] text-gray-400 mt-0.5">{stat.note}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Details */}
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Tag className="w-4 h-4" /> Genel Bilgiler
              </h3>
              <div className="space-y-4">
                {[
                  { label: 'Kategori', value: product.category || 'Belirtilmemiş' },
                  { label: 'KDV Oranı', value: vatRate > 0 ? `%${vatRate}` : 'Tanımsız' },
                  { label: 'Konum', value: product.location || (product.warehouseId ? product.warehouseId : '—') },
                  { label: 'Son Satış Fiyatı', value: sonSatisFiyati > 0 ? `${tl(sonSatisFiyati)} (KDV hariç)` : '—' },
                  { label: 'Ort. Satış Fiyatı', value: ortSatisFiyati > 0 ? `${tl(ortSatisFiyati)} (KDV hariç)` : '—' },
                  { label: 'Tedarikçi', value: product.supplier || 'Belirtilmemiş' },
                  { label: 'Tedarikçi SKU', value: product.supplierSku || '-' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-500">{item.label}</span>
                    <span className="text-sm font-bold text-gray-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing Tiers */}
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> Fiyat Katmanları
              </h3>
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                {Object.entries(product.prices || {}).map(([tier, price]: [string, number]) => (
                  <div key={tier} className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">{tier}</span>
                    <span className="text-sm font-bold text-gray-900">₺{price.toLocaleString()}</span>
                  </div>
                ))}
                {(!product.prices || Object.keys(product.prices).length === 0) && (
                  <p className="text-xs text-gray-400 italic text-center py-2">Fiyat katmanı tanımlanmamış.</p>
                )}
              </div>
            </div>
          </div>

          {/* Recent Movements (Placeholder) */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <History className="w-4 h-4" /> Son Hareketler
            </h3>
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px]">Tarih</th>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px]">Tür</th>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px] text-right">Miktar</th>
                    <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px]">Not</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr className="text-gray-400 italic">
                      <td colSpan={4} className="px-4 py-8 text-center">Hareket geçmişi yükleniyor...</td>
                    </tr>
                  ) : urunHareketleri.length === 0 ? (
                    <tr className="text-gray-400 italic">
                      <td colSpan={4} className="px-4 py-8 text-center">Henüz hareket bulunmuyor.</td>
                    </tr>
                  ) : (
                    urunHareketleri.slice(0, 20).map((m) => {
                      const d = toDate(m.timestamp);
                      return (
                      <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-600">{d ? format(d, 'dd.MM.yyyy') : '—'}</td>
                        <td className="px-4 py-3 text-xs font-medium">
                          <span className={m.type === 'in' ? 'text-green-600' : 'text-red-500'}>
                            {m.type === 'in' ? '▲ Giriş' : '▼ Çıkış'}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs text-right font-bold ${m.type === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                          {m.type === 'in' ? '+' : '-'}{m.quantity}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]" title={m.notes || m.reason}>
                          {(m.birimFiyat ?? 0) > 0
                            ? <span className="font-medium text-gray-700">{tl(m.birimFiyat!)} <span className="text-gray-400">/ birim</span></span>
                            : <span className="font-medium text-gray-700">{m.reason || '—'}</span>}
                          {m.notes && <span className="ml-1 text-gray-400">— {m.notes}</span>}
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {isEditing && (
            <ProductForm
              isOpen={isEditing}
              onClose={() => setIsEditing(false)}
              initialData={product}
              onSave={() => {
                setIsEditing(false);
                // The parent component will handle the real-time update via onSnapshot
              }}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body
  );
}
