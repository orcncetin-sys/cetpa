import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { Language } from '../translations';

interface ShortcutModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage: Language;
}

export default function ShortcutModal({ isOpen, onClose, currentLanguage }: ShortcutModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={e => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">
              {currentLanguage === 'tr' ? 'Klavye Kısayolları' : 'Keyboard Shortcuts'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {[
              {
                section: currentLanguage === 'tr' ? 'Genel' : 'General',
                shortcuts: [
                  { keys: ['⌘', 'K'], desc: currentLanguage === 'tr' ? 'Global arama' : 'Global search' },
                  { keys: ['?'],       desc: currentLanguage === 'tr' ? 'Bu ekranı göster' : 'Show this screen' },
                  { keys: ['Esc'],     desc: currentLanguage === 'tr' ? 'Kapat / Geri dön' : 'Close / Go back' },
                ],
              },
              {
                section: currentLanguage === 'tr' ? 'Navigasyon' : 'Navigation',
                shortcuts: [
                  { keys: ['D'],   desc: currentLanguage === 'tr' ? 'Dashboard' : 'Dashboard' },
                  { keys: ['O'],   desc: currentLanguage === 'tr' ? 'Siparişler' : 'Orders' },
                  { keys: ['C'],   desc: 'CRM' },
                  { keys: ['I'],   desc: currentLanguage === 'tr' ? 'Envanter' : 'Inventory' },
                  { keys: ['R'],   desc: currentLanguage === 'tr' ? 'Raporlar' : 'Reports' },
                ],
              },
              {
                section: currentLanguage === 'tr' ? 'Oluştur' : 'Create',
                shortcuts: [
                  { keys: ['N'], desc: currentLanguage === 'tr' ? 'Yeni sipariş / müşteri adayı (aktif sekme)' : 'New order / lead (active tab)' },
                ],
              },
              {
                section: currentLanguage === 'tr' ? 'Arama & Dışa Aktarma' : 'Search & Export',
                shortcuts: [
                  { keys: ['⌘', 'E'], desc: currentLanguage === 'tr' ? 'CSV dışa aktar (aktif modül)' : 'Export CSV (active module)' },
                  { keys: ['⌘', 'P'], desc: currentLanguage === 'tr' ? 'PDF oluştur / Yazdır' : 'Generate PDF / Print' },
                ],
              },
            ].map(group => (
              <div key={group.section}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{group.section}</p>
                <div className="space-y-1.5">
                  {group.shortcuts.map((sc, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{sc.desc}</span>
                      <div className="flex items-center gap-1">
                        {sc.keys.map((k, ki) => (
                          <React.Fragment key={ki}>
                            <kbd className="text-[10px] font-mono font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md border border-gray-200 shadow-sm">{k}</kbd>
                            {ki < sc.keys.length - 1 && <span className="text-gray-300 text-xs">+</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-center">
            <p className="text-[10px] text-gray-400">
              {currentLanguage === 'tr' ? 'Kısayolları kapatmak için ' : 'Press '}
              <kbd className="text-[10px] font-mono bg-white border border-gray-200 px-1 py-0.5 rounded shadow-sm">Esc</kbd>
              {currentLanguage === 'tr' ? ' tuşuna basın' : ' to close'}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
