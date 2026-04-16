import React from 'react';
import { motion } from 'motion/react';
import { Lock, ArrowRight, Check, X, Zap } from 'lucide-react';
import { PLANS, getPlanConfig, getRequiredPlan, type SubscriptionPlan, type UserSubscription } from '../types/subscription';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSubscription: UserSubscription | null;
  blockedModule: string;
  currentLanguage: 'tr' | 'en';
  onUpgrade: (planId: SubscriptionPlan) => void;
  onViewPricing: () => void;
}

export default function UpgradeModal({
  isOpen,
  onClose,
  currentSubscription,
  blockedModule,
  currentLanguage,
  onUpgrade,
  onViewPricing,
}: UpgradeModalProps) {
  if (!isOpen) return null;

  const lang = currentLanguage;
  const currentPlan = currentSubscription ? getPlanConfig(currentSubscription.plan) : null;
  const requiredPlan = getRequiredPlan(blockedModule);

  // Find the next plan that includes this module
  const upgradeCandidates = PLANS.filter(p =>
    p.modulesAllowed.includes(blockedModule) && !p.isCustomPricing
  );
  const recommendedPlan = upgradeCandidates[0];

  const t = {
    locked: lang === 'tr' ? 'Bu Modül Kilitli' : 'This Module is Locked',
    subtitle: lang === 'tr'
      ? 'Bu özelliğe erişmek için planınızı yükseltmeniz gerekiyor.'
      : 'You need to upgrade your plan to access this feature.',
    currentPlan: lang === 'tr' ? 'Mevcut Planınız' : 'Your Current Plan',
    requiredPlan: lang === 'tr' ? 'Gereken Plan' : 'Required Plan',
    upgrade: lang === 'tr' ? 'Hemen Yükselt' : 'Upgrade Now',
    viewAll: lang === 'tr' ? 'Tüm Planları Gör' : 'View All Plans',
    cancel: lang === 'tr' ? 'Vazgeç' : 'Cancel',
    includes: lang === 'tr' ? 'Bu plan şunları içerir:' : 'This plan includes:',
    perMonth: lang === 'tr' ? '/ay' : '/mo',
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="relative z-10 w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Header gradient */}
        <div className="relative bg-gradient-to-r from-[#ff4000] to-[#ff6b35] p-8 text-center overflow-hidden">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,...')] opacity-10" />
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-black text-white mb-1">{t.locked}</h2>
            <p className="text-white/70 text-sm">{t.subtitle}</p>
          </div>
        </div>

        {/* Plan comparison */}
        <div className="p-6 space-y-4">
          {/* Current vs Required */}
          <div className="flex items-center gap-3">
            {currentPlan && (
              <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1">{t.currentPlan}</p>
                <span className="text-2xl block mb-1">{currentPlan.icon}</span>
                <p className="text-white font-bold text-sm">{currentPlan.name[lang]}</p>
              </div>
            )}
            <ArrowRight className="w-5 h-5 text-[#ff4000] flex-shrink-0" />
            {recommendedPlan && (
              <div className="flex-1 bg-[#ff4000]/10 border-2 border-[#ff4000]/30 rounded-2xl p-4 text-center">
                <p className="text-[10px] font-bold text-[#ff4000]/60 uppercase tracking-wider mb-1">{t.requiredPlan}</p>
                <span className="text-2xl block mb-1">{recommendedPlan.icon}</span>
                <p className="text-white font-bold text-sm">{recommendedPlan.name[lang]}</p>
                <p className="text-[#ff4000] text-xs font-bold mt-1">
                  ₺{recommendedPlan.monthlyPrice.toLocaleString('tr-TR')}{t.perMonth}
                </p>
              </div>
            )}
          </div>

          {/* Features preview */}
          {recommendedPlan && (
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">{t.includes}</p>
              <div className="grid grid-cols-2 gap-2">
                {recommendedPlan.features.slice(0, 6).map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    <span className="text-xs text-white/60">{f[lang]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 pt-0 space-y-3">
          {recommendedPlan && (
            <button
              onClick={() => onUpgrade(recommendedPlan.id)}
              className="w-full bg-[#ff4000] hover:bg-[#ff4000]/90 active:scale-[0.98] text-white font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/30 inline-flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              {t.upgrade}
            </button>
          )}
          <button
            onClick={onViewPricing}
            className="w-full bg-white/10 hover:bg-white/15 text-white/70 font-bold py-3 rounded-2xl transition-all text-sm border border-white/10"
          >
            {t.viewAll}
          </button>
          <button
            onClick={onClose}
            className="w-full text-white/30 hover:text-white/60 text-xs font-medium py-2 transition-colors"
          >
            {t.cancel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
