/**
 * Toast.tsx — uygulama geneli bildirim sistemi.
 *
 * 2026-07-20'ye kadar bu dosya BOŞ STUB'dı (AI Studio export kalıntısı):
 * useToast no-op döndürüyordu ve uygulamadaki 170+ toast çağrısının tamamı
 * (hata bildirimleri dahil) sessizce yutuluyordu — "kaydettim ama geri
 * bildirim gelmedi" şikayetlerinin kök nedeni. Artık gerçek.
 *
 * Kullanım (mevcut çağrı imzasıyla birebir uyumlu):
 *   const toast = useToast();
 *   toast('Kaydedildi ✓', 'success');   // 'success' | 'error' | 'info' | 'warning'
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; msg: string; type: ToastType }

const ToastCtx = createContext<(msg: string, type?: string) => void>(() => {});

const STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-600/95',
  error: 'bg-red-600/95',
  warning: 'bg-amber-500/95',
  info: 'bg-gray-800/95',
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((msg: string, type?: string) => {
    if (!msg) return;
    const id = ++idRef.current;
    const t: ToastType = type === 'error' || type === 'warning' || type === 'info' ? type : 'success';
    setToasts(prev => [...prev.slice(-4), { id, msg, type: t }]); // aynı anda en fazla 5
    // Hatalar daha uzun kalsın — kullanıcı mesajı okuyabilsin
    window.setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t === 'error' ? 8000 : 4000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* z-[9999]: modallerin da üstünde; pointer-events yalnız balonlarda (tıkla-kapat) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex w-full max-w-xl flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            className={`pointer-events-auto w-fit max-w-full cursor-pointer break-words rounded-2xl px-4 py-2.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition-opacity ${STYLES[t.type]}`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

export const useToast = () => useContext(ToastCtx);
