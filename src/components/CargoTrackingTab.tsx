import React, { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw, Search, Truck, MapPin, ChevronRight } from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';

type Carrier = 'DHL' | 'UPS' | 'FedEx' | 'Yurtiçi' | 'MNG' | 'Aras' | 'PTT';

interface Props {
  darkMode: boolean;
  currentLanguage: string;
}

const carrierAccents: Record<Carrier, string> = {
  DHL:     '#CC0000',
  UPS:     '#FF6600',
  FedEx:   '#4D148C',
  'Yurtiçi': '#E30714',
  MNG:     '#FF6B00',
  Aras:    '#003DA6',
  PTT:     '#FFB800',
};

const INTERNATIONAL_CARRIERS: Carrier[] = ['DHL', 'UPS', 'FedEx'];
const TR_CARRIERS: Carrier[]             = ['Yurtiçi', 'MNG', 'Aras', 'PTT'];

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_transit: 'bg-blue-100 text-blue-700',
  out_for_delivery: 'bg-orange-100 text-orange-700',
  delivered: 'bg-green-100 text-green-700',
  exception: 'bg-red-100 text-red-700',
};

const CargoTrackingTab: React.FC<Props> = ({ darkMode, currentLanguage }) => {
  const [trackInput, setTrackInput] = useState('');
  const [trackCarrier, setTrackCarrier] = useState<Carrier>('DHL');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackResult, setTrackResult] = useState<any>(null);
  const [trackError, setTrackError] = useState('');
  const [savedTracks, setSavedTracks] = useState<any[]>([]);

  const statusLabels: Record<string, string> = {
    pending: currentLanguage === 'tr' ? 'Bekliyor' : 'Pending',
    in_transit: currentLanguage === 'tr' ? 'Yolda' : 'In Transit',
    out_for_delivery: currentLanguage === 'tr' ? 'Dağıtımda' : 'Out for Delivery',
    delivered: currentLanguage === 'tr' ? 'Teslim Edildi' : 'Delivered',
    exception: currentLanguage === 'tr' ? 'Problem' : 'Exception',
  };

  // Load saved tracks from Firestore
  useEffect(() => {
    const q = query(collection(db, 'cargoTracking'), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, snap => {
      setSavedTracks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const handleTrack = async () => {
    if (!trackInput.trim()) return;
    setTrackLoading(true);
    setTrackError('');
    setTrackResult(null);
    try {
      const { trackShipment } = await import('../services/trackingService');
      const result = await trackShipment(trackInput.trim(), trackCarrier);
      setTrackResult(result);
      if (result.error) {
        setTrackError(result.error);
        return;
      }
      // Save to Firestore (silently ignore permission errors for guest users)
      try {
        await addDoc(collection(db, 'cargoTracking'), {
          ...result,
          createdAt: serverTimestamp(),
        });
      } catch (_) {
        // Guest users may not have write permission — not a critical error
      }
    } catch (e: any) {
      setTrackError(e.message || 'Takip başarısız');
    } finally {
      setTrackLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* API Key Notice */}
      <div className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-2xl border text-xs",
        darkMode
          ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300"
          : "bg-yellow-50 border-yellow-200 text-yellow-700"
      )}>
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          {currentLanguage === 'tr'
            ? 'Türk kargo firmaları demo modunda çalışır. Gerçek veriler için Entegrasyonlar\'dan API anahtarlarını girin. Uluslararası taşıyıcılar için '
            : 'Turkish carriers run in demo mode. Add API keys in Integrations for live data. International carriers require '}
          <strong>DHL_API_KEY</strong>{', '}<strong>UPS_CLIENT_ID</strong>{', '}<strong>FEDEX_CLIENT_ID</strong>
          {currentLanguage === 'tr' ? ' ortam değişkenlerini ayarlayın.' : ' env vars.'}
        </span>
      </div>

      {/* Search Bar */}
      <div className={cn(
        "p-5 rounded-3xl border",
        darkMode ? "bg-[#1c1c1e] border-white/10" : "bg-white border-gray-100 shadow-sm"
      )}>
        <h3 className={cn("text-sm font-bold mb-4 uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
          {currentLanguage === 'tr' ? 'Kargo Takip' : 'Track Shipment'}
        </h3>
        <div className="flex gap-3 flex-wrap">
          {/* Carrier selector — split into international + TR */}
          <div className="flex flex-wrap gap-2">
            <span className={cn("text-[10px] font-bold uppercase self-center mr-1", darkMode ? "text-white/30" : "text-gray-400")}>
              🌍
            </span>
            {INTERNATIONAL_CARRIERS.map(c => (
              <button
                key={c}
                onClick={() => setTrackCarrier(c)}
                className={cn(
                  "px-3 py-2 rounded-xl text-xs font-black transition-all border outline-none",
                  trackCarrier === c
                    ? "text-white shadow-md scale-[1.02]"
                    : darkMode
                      ? "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
                      : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                )}
                style={trackCarrier === c ? { backgroundColor: carrierAccents[c], borderColor: carrierAccents[c] } : {}}
              >
                {c}
              </button>
            ))}
            <span className={cn("text-[10px] font-bold uppercase self-center mx-1", darkMode ? "text-white/30" : "text-gray-400")}>
              🇹🇷
            </span>
            {TR_CARRIERS.map(c => (
              <button
                key={c}
                onClick={() => setTrackCarrier(c)}
                className={cn(
                  "px-3 py-2 rounded-xl text-xs font-black transition-all border outline-none",
                  trackCarrier === c
                    ? "text-white shadow-md scale-[1.02]"
                    : darkMode
                      ? "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
                      : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                )}
                style={trackCarrier === c ? { backgroundColor: carrierAccents[c], borderColor: carrierAccents[c] } : {}}
              >
                {c}
              </button>
            ))}
          </div>
          {/* Tracking number input */}
          <input
            type="text"
            value={trackInput}
            onChange={e => setTrackInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTrack()}
            placeholder={currentLanguage === 'tr' ? 'Takip numarası girin...' : 'Enter tracking number...'}
            className={cn(
              "flex-1 min-w-[200px] rounded-xl px-4 py-2.5 text-sm outline-none border transition-all",
              darkMode
                ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-[#ff4000]"
                : "bg-gray-50 border-gray-200 text-[#1D1D1F] placeholder-gray-400 focus:border-[#ff4000] focus:ring-2 focus:ring-[#ff4000]/10"
            )}
          />
          <button
            onClick={handleTrack}
            disabled={trackLoading || !trackInput.trim()}
            className="apple-button-primary px-6 disabled:opacity-50 flex items-center gap-2"
          >
            {trackLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {trackLoading
              ? (currentLanguage === 'tr' ? 'Aranıyor...' : 'Searching...')
              : (currentLanguage === 'tr' ? 'Takip Et' : 'Track')}
          </button>
        </div>
        {trackError && (
          <p className="mt-3 text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{trackError}</p>
        )}
      </div>

      {/* Result Card */}
      {trackResult && !trackResult.error && (
        <div className={cn("rounded-3xl border overflow-hidden", darkMode ? "bg-[#1c1c1e] border-white/10" : "bg-white border-gray-100 shadow-sm")}>
          {/* Header */}
          <div className="p-5 border-b" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : '#f0f0f2' }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="text-xs font-black px-3 py-1 rounded-full text-white"
                    style={{ backgroundColor: carrierAccents[trackResult.carrier as Carrier] || '#666' }}
                  >
                    {trackResult.carrier}
                  </span>
                  <span className={cn("text-xs font-bold px-3 py-1 rounded-full", statusColors[trackResult.statusCode] || 'bg-gray-100 text-gray-700')}>
                    {statusLabels[trackResult.statusCode] || trackResult.status}
                  </span>
                  {trackResult.isMock && (
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", darkMode ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-700")}>
                      DEMO
                    </span>
                  )}
                </div>
                <p className={cn("text-lg font-black tracking-tight", darkMode ? "text-white" : "text-[#1D1D1F]")}>
                  {trackResult.trackingNumber}
                </p>
                {trackResult.service && (
                  <p className={cn("text-xs mt-0.5", darkMode ? "text-white/40" : "text-gray-400")}>{trackResult.service}</p>
                )}
              </div>
              <div className="text-right">
                <p className={cn("text-[10px] uppercase tracking-widest font-bold mb-1", darkMode ? "text-white/30" : "text-gray-400")}>
                  {currentLanguage === 'tr' ? 'Tahmini Teslimat' : 'Est. Delivery'}
                </p>
                <p className={cn("text-sm font-bold", darkMode ? "text-white" : "text-[#1D1D1F]")}>
                  {trackResult.estimatedDelivery
                    ? new Date(trackResult.estimatedDelivery).toLocaleDateString(
                        currentLanguage === 'tr' ? 'tr-TR' : 'en-US',
                        { day: 'numeric', month: 'short', year: 'numeric' }
                      )
                    : '-'}
                </p>
              </div>
            </div>
            {/* Route */}
            <div className="flex items-center gap-3 mt-4">
              <div className={cn("text-center", darkMode ? "text-white/60" : "text-gray-600")}>
                <p className="text-[10px] uppercase tracking-widest font-bold mb-0.5 text-gray-400">From</p>
                <p className="text-sm font-bold">{trackResult.origin}</p>
              </div>
              <div className="flex-1 flex items-center gap-1">
                <div className={cn("flex-1 h-px", darkMode ? "bg-white/10" : "bg-gray-200")} />
                <Truck className="w-4 h-4 text-[#ff4000] flex-shrink-0" />
                <div className={cn("flex-1 h-px", darkMode ? "bg-white/10" : "bg-gray-200")} />
              </div>
              <div className={cn("text-center", darkMode ? "text-white/60" : "text-gray-600")}>
                <p className="text-[10px] uppercase tracking-widest font-bold mb-0.5 text-gray-400">To</p>
                <p className="text-sm font-bold">{trackResult.destination}</p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="p-5">
            <p className={cn("text-[10px] uppercase tracking-widest font-bold mb-4", darkMode ? "text-white/30" : "text-gray-400")}>
              {currentLanguage === 'tr' ? 'Kargo Hareketi' : 'Tracking Events'}
            </p>
            <div className="space-y-0">
              {(trackResult.events || []).map((evt: any, i: number) => (
                <div key={i} className="flex gap-4 relative">
                  {/* Timeline line */}
                  {i < (trackResult.events || []).length - 1 && (
                    <div className={cn("absolute left-[11px] top-6 w-px h-full", darkMode ? "bg-white/10" : "bg-gray-100")} />
                  )}
                  {/* Dot */}
                  <div className={cn(
                    "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 z-10",
                    i === 0
                      ? "bg-[#ff4000]"
                      : darkMode ? "bg-white/10 border border-white/20" : "bg-gray-100 border border-gray-200"
                  )}>
                    {i === 0 && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <div className="pb-5 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={cn("text-sm font-semibold", darkMode ? "text-white/90" : "text-[#1D1D1F]")}>
                          {evt.description}
                        </p>
                        <p className={cn("text-xs mt-0.5", darkMode ? "text-white/40" : "text-gray-400")}>
                          <MapPin className="w-3 h-3 inline mr-1" />{evt.location || '-'}
                        </p>
                      </div>
                      <p className={cn("text-[10px] font-bold whitespace-nowrap", darkMode ? "text-white/30" : "text-gray-400")}>
                        {evt.timestamp
                          ? new Date(evt.timestamp).toLocaleString(
                              currentLanguage === 'tr' ? 'tr-TR' : 'en-US',
                              { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
                            )
                          : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Tracked Shipments */}
      {savedTracks.length > 0 && (
        <div className={cn("rounded-3xl border overflow-hidden", darkMode ? "bg-[#1c1c1e] border-white/10" : "bg-white border-gray-100 shadow-sm")}>
          <div className="px-5 py-4 border-b" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : '#f0f0f2' }}>
            <h3 className={cn("text-sm font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
              {currentLanguage === 'tr' ? 'Son Takipler' : 'Recent Tracks'}
            </h3>
          </div>
          <div className="divide-y" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.06)' : '#f5f5f7' }}>
            {savedTracks.slice(0, 8).map((t: any) => (
              <button
                key={t.id}
                onClick={() => {
                  setTrackInput(t.trackingNumber);
                  setTrackCarrier(t.carrier as Carrier);
                  setTrackResult(t);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-5 py-3 transition-all text-left outline-none",
                  darkMode ? "hover:bg-white/5" : "hover:bg-gray-50/60"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-[10px] font-black px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: carrierAccents[t.carrier as Carrier] ?? '#555' }}
                  >
                    {t.carrier}
                  </span>
                  <span className={cn("text-sm font-mono font-bold", darkMode ? "text-white/80" : "text-[#1D1D1F]")}>
                    {t.trackingNumber}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", statusColors[t.statusCode] || 'bg-gray-100 text-gray-600')}>
                    {statusLabels[t.statusCode] || t.status}
                  </span>
                  <ChevronRight className={cn("w-4 h-4", darkMode ? "text-white/20" : "text-gray-300")} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CargoTrackingTab;
