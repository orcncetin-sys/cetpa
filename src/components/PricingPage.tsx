import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, Zap, ChevronDown, Shield, CreditCard, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  PLANS,
  type PlanConfig,
  type SubscriptionPlan,
  type BillingCycle,
  formatPrice,
  yearlySavingsPercent,
  ALL_MODULES,
} from '../types/subscription';

interface PricingPageProps {
  currentLanguage: 'tr' | 'en';
  onSelectPlan: (planId: SubscriptionPlan, cycle: BillingCycle) => void;
  onStartTrial: (planId: SubscriptionPlan) => void;
  showBackButton?: boolean;
  onBack?: () => void;
}

export default function PricingPage({
  currentLanguage,
  onSelectPlan,
  onStartTrial,
  showBackButton,
  onBack,
}: PricingPageProps) {
  const darkMode = false;
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const lang = currentLanguage;

  const t = {
    heroTitle: lang === 'tr' ? 'İşletmeniz İçin Doğru Planı Seçin' : 'Choose the Right Plan for Your Business',
    heroSubtitle: lang === 'tr'
      ? 'Her ölçekteki işletme için esnek fiyatlandırma. 14 gün ücretsiz deneyin.'
      : 'Flexible pricing for businesses of all sizes. Try free for 14 days.',
    monthly: lang === 'tr' ? 'Aylık' : 'Monthly',
    yearly: lang === 'tr' ? 'Yıllık' : 'Yearly',
    save: lang === 'tr' ? 'tasarruf' : 'save',
    perMonth: lang === 'tr' ? '/ay' : '/mo',
    perYear: lang === 'tr' ? '/yıl' : '/yr',
    mostPopular: lang === 'tr' ? 'En Popüler' : 'Most Popular',
    startTrial: lang === 'tr' ? '14 Gün Ücretsiz Dene' : 'Start 14-Day Free Trial',
    comparePlans: lang === 'tr' ? 'Planları Karşılaştır' : 'Compare Plans',
    faqTitle: lang === 'tr' ? 'Sıkça Sorulan Sorular' : 'Frequently Asked Questions',
    back: lang === 'tr' ? 'Geri' : 'Back',
    users: lang === 'tr' ? 'kullanıcı' : 'users',
    module: lang === 'tr' ? 'Modül' : 'Module',
    included: lang === 'tr' ? 'Dahil' : 'Included',
    security: lang === 'tr' ? 'Güvenli Ödeme' : 'Secure Payment',
    guarantee: lang === 'tr' ? '30 Gün Para İade Garantisi' : '30-Day Money-Back Guarantee',
    global: lang === 'tr' ? 'Global Erişim' : 'Global Access',
  };

  const faqs = [
    {
      q: lang === 'tr' ? 'Ücretsiz deneme nasıl çalışır?' : 'How does the free trial work?',
      a: lang === 'tr'
        ? '14 gün boyunca seçtiğiniz planın tüm özelliklerine erişebilirsiniz. Kredi kartı gerekmez. Deneme süresi sonunda plan otomatik olarak duraklatılır.'
        : 'You get full access to all features of your chosen plan for 14 days. No credit card required. Your plan pauses automatically when the trial ends.',
    },
    {
      q: lang === 'tr' ? 'Planımı değiştirebilir miyim?' : 'Can I change my plan?',
      a: lang === 'tr'
        ? 'Evet, istediğiniz zaman planınızı yükseltebilir veya düşürebilirsiniz. Değişiklik anında aktif olur ve fiyat farkı otomatik hesaplanır.'
        : 'Yes, you can upgrade or downgrade at any time. Changes take effect immediately and price differences are automatically calculated.',
    },
    {
      q: lang === 'tr' ? 'İptal etmek istersem ne olur?' : 'What happens if I cancel?',
      a: lang === 'tr'
        ? 'İstediğiniz zaman iptal edebilirsiniz. Mevcut dönem sonuna kadar erişiminiz devam eder. Verileriniz 90 gün boyunca saklanır.'
        : 'You can cancel at any time. Your access continues until the end of the current period. Your data is kept for 90 days.',
    },
    {
      q: lang === 'tr' ? 'Fatura alabilir miyim?' : 'Can I get an invoice?',
      a: lang === 'tr'
        ? 'Evet, her ödeme sonrası otomatik e-Fatura kesilir. Abonelik panelinden geçmiş faturalarınızı indirebilirsiniz.'
        : 'Yes, an automatic e-Invoice is issued after each payment. You can download past invoices from the subscription panel.',
    },
  ];

  const getDisplayPrice = (plan: PlanConfig) => {
    if (plan.isCustomPricing) return formatPrice(0, lang);
    return billingCycle === 'monthly'
      ? formatPrice(plan.monthlyPrice, lang)
      : formatPrice(Math.round(plan.yearlyPrice / 12), lang);
  };

  return (
    <div className={cn("min-h-screen relative overflow-hidden font-avenir transition-colors duration-500", darkMode ? "bg-[#0a0a0a] text-white" : "bg-[#f5f5f7] text-[#1D1D1F]")}>
      {/* Background */}
      <div className={cn("fixed inset-0 transition-opacity duration-700", darkMode ? "opacity-100" : "opacity-0 invisible")}>
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] via-[#111] to-[#0a0a0a]" />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-60 -right-60 w-[800px] h-[800px] bg-[#ff4000]/15 rounded-full blur-[180px] animate-pulse" />
          <div className="absolute -bottom-60 -left-60 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }} />
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] bg-white/[0.02] rounded-full blur-[100px]" />
        </div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div className="flex items-center justify-between mb-8">
          {onBack && (
            <button onClick={onBack} className={cn("flex items-center gap-2 text-sm font-medium transition-colors", darkMode ? "text-white/50 hover:text-white" : "text-black/50 hover:text-black")}>
              <X className="w-4 h-4" /> {t.back}
            </button>
          )}

        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
          className="text-center mb-12 sm:mb-16"
        >
          <h1 className={cn("text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight", darkMode ? "text-white" : "text-[#1D1D1F]")}>
            {t.heroTitle}
          </h1>
          <p className={cn("text-base sm:text-lg mt-4 max-w-2xl mx-auto", darkMode ? "text-white/50" : "text-black/50")}>
            {t.heroSubtitle}
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mt-10">
            <span className={cn("text-sm font-bold transition-colors", billingCycle === 'monthly' ? (darkMode ? 'text-white' : 'text-black') : 'text-gray-400')}>
              {t.monthly}
            </span>
            <button
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
              className={cn("relative w-16 h-8 border rounded-full transition-all", darkMode ? "bg-white/10 border-white/20 hover:bg-white/15" : "bg-black/5 border-black/10 hover:bg-black/10")}
            >
              <motion.div
                className="absolute top-1 w-6 h-6 bg-[#ff4000] rounded-full shadow-lg shadow-[#ff4000]/30"
                animate={{ left: billingCycle === 'yearly' ? 34 : 4 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
            <span className={cn("text-sm font-bold transition-colors", billingCycle === 'yearly' ? (darkMode ? 'text-white' : 'text-black') : 'text-gray-400')}>
              {t.yearly}
            </span>
            {billingCycle === 'yearly' && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-green-500/20 text-green-500 text-xs font-bold px-3 py-1 rounded-full border border-green-500/30"
              >
                ~17% {t.save}
              </motion.span>
            )}
          </div>
        </motion.div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-16">
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.1, ease: [0.23, 1, 0.32, 1] }}
              className={`relative group ${plan.highlight ? 'md:-mt-4 md:mb-4' : ''}`}
            >
              {plan.highlight && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20">
                  <span className="bg-[#ff4000] text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg shadow-[#ff4000]/40">
                    {t.mostPopular}
                  </span>
                </div>
              )}
              <div className={cn("h-full backdrop-blur-2xl border rounded-3xl overflow-hidden transition-all duration-500", 
                darkMode 
                  ? (plan.highlight ? 'bg-white/[0.08] border-[#ff4000]/40 shadow-2xl shadow-[#ff4000]/10' : 'bg-white/[0.06] border-white/10 hover:border-white/20')
                  : (plan.highlight ? 'bg-white border-[#ff4000]/40 shadow-2xl shadow-[#ff4000]/10' : 'bg-white/60 border-black/5 hover:border-black/10')
              )}>
                {/* Card Header */}
                <div className={cn("p-6 sm:p-8 relative overflow-hidden", plan.gradient)}>
                  <div className="absolute inset-0 bg-black/20" />
                  <div className="relative z-10">
                    <span className="text-3xl mb-3 block">{plan.icon}</span>
                    <h3 className="text-xl font-black text-white">{plan.name[lang]}</h3>
                    <p className="text-white/60 text-sm mt-1">{plan.subtitle[lang]}</p>
                    <div className="mt-5">
                      {plan.isCustomPricing ? (
                        <p className="text-2xl font-black text-white">{formatPrice(0, lang)}</p>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl sm:text-4xl font-black text-white">{getDisplayPrice(plan)}</span>
                          <span className="text-white/50 text-sm font-medium">{t.perMonth}</span>
                        </div>
                      )}
                      {!plan.isCustomPricing && billingCycle === 'yearly' && (
                        <p className="text-green-300 text-xs font-bold mt-1">
                          %{yearlySavingsPercent(plan)} {t.save} — {formatPrice(plan.yearlyPrice, lang)}{t.perYear}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Features */}
                <div className="p-6 sm:p-8 space-y-3">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className={cn("text-sm", darkMode ? "text-white/70" : "text-black/70")}>{f[lang]}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div className="p-6 sm:p-8 pt-0 space-y-3">
                  <button
                    onClick={() => plan.isCustomPricing ? null : onSelectPlan(plan.id, billingCycle)}
                    className={cn("w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]",
                      plan.highlight
                        ? 'bg-[#ff4000] hover:bg-[#ff4000]/90 text-white shadow-lg shadow-[#ff4000]/30'
                        : plan.isCustomPricing
                          ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 border border-amber-500/30'
                          : darkMode 
                            ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                            : 'bg-black/5 hover:bg-black/10 text-black border border-black/10'
                    )}
                  >
                    {plan.cta[lang]}
                  </button>
                  {!plan.isCustomPricing && (
                    <button
                      onClick={() => onStartTrial(plan.id)}
                      className={cn("w-full py-2.5 text-xs font-medium transition-colors", darkMode ? "text-white/40 hover:text-white/80" : "text-black/40 hover:text-black/80")}
                    >
                      {t.startTrial}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Compare Plans Button */}
        <div className="text-center mb-8">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className={cn("inline-flex items-center gap-2 text-sm font-bold transition-colors", darkMode ? "text-white/50 hover:text-white" : "text-black/50 hover:text-black")}
          >
            {t.comparePlans}
            <ChevronDown className={`w-4 h-4 transition-transform ${showComparison ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Feature Comparison Table */}
        <AnimatePresence>
          {showComparison && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-16 overflow-hidden"
            >
              <div className={cn("backdrop-blur-xl border rounded-3xl overflow-hidden", darkMode ? "bg-white/[0.04] border-white/10" : "bg-white border-black/10")}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={cn("border-b", darkMode ? "border-white/10" : "border-black/10")}>
                        <th className={cn("text-left py-4 px-6 font-bold text-xs uppercase tracking-wider", darkMode ? "text-white/50" : "text-black/50")}>{t.module}</th>
                        {PLANS.map(p => (
                          <th key={p.id} className={cn("text-center py-4 px-4 font-bold text-xs uppercase tracking-wider", darkMode ? "text-white" : "text-black")}>
                            {p.icon} {p.name[lang]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ALL_MODULES.map(mod => (
                        <tr key={mod.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-6 text-white/70 font-medium">
                            {mod.icon} {mod.label[lang]}
                          </td>
                          {PLANS.map(plan => (
                            <td key={plan.id} className="text-center py-3 px-4">
                              {plan.modulesAllowed.includes(mod.id) ? (
                                <Check className="w-5 h-5 text-green-400 mx-auto" />
                              ) : (
                                <X className="w-4 h-4 text-white/15 mx-auto" />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FAQ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="max-w-3xl mx-auto mb-16"
        >
          <h2 className="text-2xl sm:text-3xl font-black text-white text-center mb-8">
            {t.faqTitle}
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden transition-all hover:border-white/20"
              >
                <button
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="text-white font-bold text-sm pr-4">{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-white/40 flex-shrink-0 transition-transform ${expandedFaq === i ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {expandedFaq === i && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 text-white/50 text-sm leading-relaxed">{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-8 pb-12">
          {[
            { icon: Shield, text: t.security },
            { icon: CreditCard, text: t.guarantee },
            { icon: Globe, text: t.global },
          ].map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex items-center gap-2 text-white/30">
              <Icon className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
