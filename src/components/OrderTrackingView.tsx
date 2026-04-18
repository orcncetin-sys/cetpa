/**
 * OrderTrackingView.tsx — Public order-status page (no auth required)
 *
 * Rendered when the URL contains `?track=<orderId>`.
 * Fetches from GET /api/track/:orderId (public Express route)
 * and shows a branded status timeline to the customer.
 */

import React, { useEffect, useState } from 'react';
import {
  Package, Truck, CheckCircle2, Clock, AlertCircle,
  MapPin, RefreshCw, ExternalLink,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackingOrder {
  id:                string;
  orderNo:           string;
  customerName:      string;
  status:            string;
  trackingNumber?:   string;
  shippingAddress?:  string;
  estimatedDelivery?: string;
  lineItems?:        { name?: string; title?: string; quantity: number; price: number }[];
  updatedAt?:        string;
  createdAt?:        string;
}

// ── Status timeline config ────────────────────────────────────────────────────

const STEPS = [
  { key: 'Pending',    labelTR: 'Sipariş Alındı',   labelEN: 'Order Received',  icon: Clock       },
  { key: 'Processing', labelTR: 'Hazırlanıyor',      labelEN: 'Processing',      icon: Package     },
  { key: 'Shipped',    labelTR: 'Kargoya Verildi',   labelEN: 'Shipped',         icon: Truck       },
  { key: 'Delivered',  labelTR: 'Teslim Edildi',     labelEN: 'Delivered',       icon: CheckCircle2 },
];

function stepIndex(status: string) {
  const i = STEPS.findIndex(s => s.key === status);
  return i === -1 ? 0 : i;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface OrderTrackingViewProps {
  orderId:         string;
  currentLanguage?: string;
  onBack?:         () => void;
}

export default function OrderTrackingView({ orderId, currentLanguage = 'tr', onBack }: OrderTrackingViewProps) {
  const tr = currentLanguage === 'tr';
  const [order,   setOrder]   = useState<TrackingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/track/${orderId}`);
      const d = await r.json() as { success: boolean; order?: TrackingOrder; error?: string };
      if (!d.success || !d.order) throw new Error(d.error || 'Sipariş bulunamadı.');
      setOrder(d.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [orderId]);

  const activeStep = order ? stepIndex(order.status) : 0;
  const isCancelled = order?.status === 'Cancelled';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Brand header ── */}
      <header className="bg-[#1a3a5c] text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <Package className="w-4 h-4" />
          </div>
          <div>
            <p className="font-bold text-sm">CETPA</p>
            <p className="text-[11px] text-white/60">{tr ? 'Sipariş Takip' : 'Order Tracking'}</p>
          </div>
        </div>
        {onBack && (
          <button onClick={onBack} className="text-white/70 hover:text-white text-xs font-medium flex items-center gap-1">
            <ExternalLink className="w-3.5 h-3.5" />
            {tr ? 'Kapat' : 'Close'}
          </button>
        )}
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-8 space-y-6">

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <RefreshCw className="w-8 h-8 text-[#1a3a5c] animate-spin" />
            <p className="text-sm text-gray-500">{tr ? 'Sipariş bilgileri yükleniyor…' : 'Loading order…'}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="font-bold text-red-700">{tr ? 'Sipariş bulunamadı' : 'Order not found'}</p>
            <p className="text-xs text-red-500">{error}</p>
            <button onClick={load} className="mt-2 text-xs font-bold text-[#1a3a5c] hover:underline">
              {tr ? 'Tekrar dene' : 'Retry'}
            </button>
          </div>
        )}

        {order && !loading && (
          <>
            {/* Order summary card */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Sipariş No' : 'Order No'}</p>
                  <p className="font-bold text-lg text-[#1a3a5c]">#{order.orderNo}</p>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                  isCancelled           ? 'bg-gray-100 text-gray-500' :
                  order.status === 'Delivered'  ? 'bg-emerald-100 text-emerald-700' :
                  order.status === 'Shipped'    ? 'bg-blue-100 text-blue-700' :
                  order.status === 'Processing' ? 'bg-purple-100 text-purple-700' :
                                                  'bg-amber-100 text-amber-700'
                }`}>
                  {tr
                    ? (isCancelled ? 'İptal' : STEPS.find(s => s.key === order.status)?.labelTR ?? order.status)
                    : (isCancelled ? 'Cancelled' : STEPS.find(s => s.key === order.status)?.labelEN ?? order.status)}
                </span>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-700">{order.customerName}</span>
                </div>
                {order.shippingAddress && (
                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <span>{order.shippingAddress}</span>
                  </div>
                )}
                {order.trackingNumber && (
                  <div className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span>{tr ? 'Takip No' : 'Tracking'}:</span>
                    <span className="font-mono font-bold text-gray-800">{order.trackingNumber}</span>
                  </div>
                )}
                {order.estimatedDelivery && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span>{tr ? 'Tahmini teslimat' : 'Est. delivery'}:</span>
                    <span className="font-bold text-gray-800">
                      {new Date(order.estimatedDelivery).toLocaleDateString('tr-TR')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Status timeline */}
            {!isCancelled && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-5">{tr ? 'Sipariş Durumu' : 'Order Status'}</p>
                <div className="space-y-0">
                  {STEPS.map((step, i) => {
                    const done   = i <= activeStep;
                    const active = i === activeStep;
                    const Icon   = step.icon;
                    return (
                      <div key={step.key} className="flex gap-4">
                        {/* Icon + connector */}
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                            active ? 'bg-[#1a3a5c] text-white shadow-lg ring-4 ring-[#1a3a5c]/10' :
                            done   ? 'bg-emerald-500 text-white' :
                                     'bg-gray-100 text-gray-400'
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          {i < STEPS.length - 1 && (
                            <div className={`w-0.5 h-10 my-0.5 rounded-full ${done && i < activeStep ? 'bg-emerald-400' : 'bg-gray-100'}`} />
                          )}
                        </div>
                        {/* Label */}
                        <div className="pb-8 pt-1.5">
                          <p className={`text-sm font-bold ${active ? 'text-[#1a3a5c]' : done ? 'text-gray-700' : 'text-gray-300'}`}>
                            {tr ? step.labelTR : step.labelEN}
                          </p>
                          {active && (
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {tr ? 'Güncel durum' : 'Current status'}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isCancelled && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-center">
                <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="font-bold text-gray-600">{tr ? 'Sipariş İptal Edildi' : 'Order Cancelled'}</p>
              </div>
            )}

            {/* Items */}
            {(order.lineItems ?? []).length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Ürünler' : 'Items'}</p>
                <div className="divide-y divide-gray-50">
                  {order.lineItems!.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                      <div>
                        <p className="font-medium text-gray-800">{item.title ?? item.name ?? '—'}</p>
                        <p className="text-[11px] text-gray-400">×{item.quantity}</p>
                      </div>
                      <p className="font-bold text-gray-700">
                        ₺{(item.price * item.quantity).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Refresh */}
            <button
              onClick={load}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {tr ? 'Yenile' : 'Refresh'}
            </button>
          </>
        )}
      </main>

      <footer className="py-4 text-center text-[10px] text-gray-400">
        © {new Date().getFullYear()} Cetpa Yazılım — {tr ? 'Bu sayfa müşteri bilgilendirme amaçlıdır.' : 'This page is for customer information only.'}
      </footer>
    </div>
  );
}
