/**
 * LocationQRModal.tsx — Depo/araç için yazdırılabilir QR etiketi.
 *
 * Bir depo (warehouse) veya aracın (vehicle) benzersiz QR kodunu ekranda
 * gösterir ve yazdırır. QR değeri src/lib/locationQr.ts'teki biçimde üretilir
 * (CETPA-LOC:<type>:<id>) ve Faz 3'teki transfer scan ekranında okunur.
 */
import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer } from 'lucide-react';
import { locationQrValue, type LocationType } from '../lib/locationQr';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage: 'tr' | 'en';
  locationType: LocationType;
  locationId: string;
  locationName: string;   // depo adı veya araç plakası
  subtitle?: string;      // opsiyonel: sürücü/konum vs.
}

export default function LocationQRModal({
  isOpen, onClose, currentLanguage, locationType, locationId, locationName, subtitle,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  if (!isOpen) return null;

  const tr = currentLanguage === 'tr';
  const qrValue = locationQrValue(locationType, locationId);
  const typeLabel = locationType === 'warehouse' ? (tr ? 'DEPO' : 'WAREHOUSE') : (tr ? 'ARAÇ' : 'VEHICLE');

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #location-qr-print, #location-qr-print * { visibility: visible !important; }
          #location-qr-print { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
        }
      `}</style>
      <div className="apple-card w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto print:max-h-none print:overflow-visible">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{tr ? 'QR Etiketi' : 'QR Label'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div id="location-qr-print" ref={printRef} className="flex flex-col items-center gap-3 py-4">
          <div className="text-center">
            <p className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{typeLabel}</p>
            <p className="text-xl font-black text-gray-900">{locationName}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
          <div className="p-4 bg-white border-2 border-gray-900 rounded-2xl">
            <QRCodeSVG value={qrValue} size={200} level="M" includeMargin={false} />
          </div>
          <p className="text-[10px] font-mono text-gray-400 break-all text-center max-w-[220px]">{qrValue}</p>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={handlePrint} className="apple-button-primary flex-1 flex items-center justify-center gap-2 text-sm">
            <Printer className="w-4 h-4" />
            {tr ? 'Yazdır' : 'Print'}
          </button>
          <button onClick={onClose} className="apple-button-secondary text-sm px-5">
            {tr ? 'Kapat' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
