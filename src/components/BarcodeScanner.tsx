import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Scan, Keyboard, Camera } from 'lucide-react';
import BarcodeScannerComponent from 'react-qr-barcode-scanner';

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  currentLanguage: 'tr' | 'en';
  title?: string;
  placeholder?: string;
}

export default function BarcodeScanner({ isOpen, onClose, onScan, currentLanguage, title, placeholder }: BarcodeScannerProps) {
  const [manualBarcode, setManualBarcode] = useState('');
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualBarcode.trim()) {
      onScan(manualBarcode.trim());
      setManualBarcode('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/10 rounded-xl">
              <Scan className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{title || (currentLanguage === 'tr' ? 'Barkod Tara' : 'Scan Barcode')}</h2>
              <p className="text-sm text-gray-500">{currentLanguage === 'tr' ? 'Ürün barkodunu okutun veya manuel girin.' : 'Scan product barcode or enter manually.'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex p-1 bg-gray-100 rounded-xl">
            <button
              onClick={() => setMode('camera')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all",
                mode === 'camera' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              <Camera className="w-4 h-4" />
              {currentLanguage === 'tr' ? 'Kamera' : 'Camera'}
            </button>
            <button
              onClick={() => setMode('manual')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all",
                mode === 'manual' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              <Keyboard className="w-4 h-4" />
              {currentLanguage === 'tr' ? 'Manuel' : 'Manual'}
            </button>
          </div>

          {mode === 'camera' ? (
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-black border-4 border-gray-100">
              <BarcodeScannerComponent
                width="100%"
                height="100%"
                onUpdate={(err, result) => {
                  if (result) {
                    onScan(result.getText());
                    onClose();
                  }
                }}
              />
              <div className="absolute inset-0 border-2 border-brand opacity-30 pointer-events-none m-12 rounded-lg" />
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-brand opacity-50 animate-pulse" />
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">{placeholder || (currentLanguage === 'tr' ? 'Barkod No' : 'Barcode No')}</label>
                <input
                  autoFocus
                  type="text"
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value)}
                  className="apple-input w-full text-center text-lg font-bold tracking-widest"
                  placeholder="000000000000"
                />
              </div>
              <button
                type="submit"
                className="apple-button-primary w-full py-4 text-lg"
              >
                {currentLanguage === 'tr' ? 'Onayla' : 'Confirm'}
              </button>
            </form>
          )}
        </div>

        <div className="p-4 bg-gray-50 text-center">
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
            {currentLanguage === 'tr' ? 'Kameraya erişim izni verdiğinizden emin olun' : 'Make sure you have granted camera access'}
          </p>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
