import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void; // Alias for onClose
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmLabel?: string; // Alias for confirmText
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'default';
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  message,
  confirmText,
  confirmLabel,
  cancelText = 'Vazgeç',
  variant = 'danger'
}) => {
  if (!isOpen) return null;

  const handleClose = onCancel || onClose || (() => {});
  const finalConfirmText = confirmLabel || confirmText || 'Sil';
  const finalVariant = variant === 'default' ? 'info' : variant;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                finalVariant === 'danger' ? 'bg-red-50 text-red-500' : 
                finalVariant === 'warning' ? 'bg-orange-50 text-orange-500' : 
                'bg-blue-50 text-blue-500'
              }`}>
                <AlertTriangle className="w-6 h-6" />
              </div>
              <button 
                onClick={handleClose}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <h3 className="text-xl font-bold text-[#1D1D1F] mb-2">{title}</h3>
            <p className="text-[#86868B] text-sm leading-relaxed mb-8">
              {message}
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="apple-button-secondary flex-1"
              >
                {cancelText}
              </button>
              <button
                onClick={() => {
                  onConfirm();
                  handleClose();
                }}
                className={cn(
                  "flex-1 px-6 py-3 rounded-2xl font-bold text-white transition-all active:scale-95 shadow-lg",
                  finalVariant === 'danger' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 
                  finalVariant === 'warning' ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20' : 
                  'bg-blue-500 hover:bg-blue-600 shadow-blue-500/20'
                )}
              >
                {finalConfirmText}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ConfirmModal;
