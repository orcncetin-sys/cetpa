import { motion } from 'motion/react';
import { Lock, ArrowRight, Check, Zap } from 'lucide-react';
import { PLANS, getPlanConfig, type SubscriptionPlan, type UserSubscription } from '../types/subscription';

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
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />

      {/* Modal — white / light */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 24 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="relative z-10 w-full max-w-md bg-white border border-black/[0.08] rounded-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className="relative bg-gradient-to-r from-[#ff4000] to-[#ff6b35] p-8 text-center overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
          <div className="relative z-10">
            <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Lock className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-black text-white mb-1">{t.locked}</h2>
            <p className="text-white/80 text-sm">{t.subtitle}</p>
          </div>
        </div>

        {/* Plan comparison */}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            {currentPlan && (
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-center">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{t.currentPlan}</p>
                <span className="text-2xl block mb-1">{currentPlan.icon}</span>
                <p className="text-gray-800 font-bold text-sm">{currentPlan.name[lang]}</p>
              </div>
            )}
            <ArrowRight className="w-5 h-5 text-[#ff4000] flex-shrink-0" />
            {recommendedPlan && (
              <div className="flex-1 bg-[#ff4000]/5 border-2 border-[#ff4000]/20 rounded-2xl p-4 text-center">
                <p className="text-[10px] font-bold text-[#ff4000]/70 uppercase tracking-wider mb-1">{t.requiredPlan}</p>
                <span className="text-2xl block mb-1">{recommendedPlan.icon}</span>
                <p className="text-gray-900 font-bold text-sm">{recommendedPlan.name[lang]}</p>
                <p className="text-[#ff4000] text-xs font-bold mt-1">
                  ₺{recommendedPlan.monthlyPrice.toLocaleString('tr-TR')}{t.perMonth}
                </p>
              </div>
            )}
          </div>

          {/* Features preview */}
          {recommendedPlan && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">{t.includes}</p>
              <div className="grid grid-cols-2 gap-2">
                {recommendedPlan.features.slice(0, 6).map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span className="text-xs text-gray-600">{f[lang]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 space-y-2.5">
          {recommendedPlan && (
            <button
              onClick={() => onUpgrade(recommendedPlan.id)}
              className="w-full bg-[#ff4000] hover:bg-[#e63800] active:scale-[0.98] text-white font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/25 inline-flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              {t.upgrade}
            </button>
          )}
          <button
            onClick={onViewPricing}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-2xl transition-all text-sm"
          >
            {t.viewAll}
          </button>
          <button
            onClick={onClose}
            className="w-full text-gray-400 hover:text-gray-600 text-xs font-medium py-2 transition-colors"
          >
            {t.cancel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
