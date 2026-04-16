import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CreditCard, Calendar, Users, Zap, AlertTriangle, ChevronRight,
  Download, Check, X, Clock, Shield, Crown
} from 'lucide-react';
import {
  type UserSubscription,
  type SubscriptionPlan,
  type BillingCycle,
  getPlanConfig,
  PLANS,
  formatPrice,
  daysRemaining,
  isTrialActive,
  yearlySavingsPercent,
} from '../types/subscription';

interface SubscriptionPanelProps {
  currentLanguage: 'tr' | 'en';
  subscription: UserSubscription | null;
  paymentHistory?: PaymentRecord[];
  onChangePlan: (planId: SubscriptionPlan, cycle: BillingCycle) => void;
  onCancelSubscription: () => void;
  onViewPricing: () => void;
}

interface PaymentRecord {
  id: string;
  date: string;
  amount: number;
  plan: string;
  planName?: Record<string, string>;
  cycle?: string;
  status: 'paid' | 'pending' | 'failed';
  invoiceUrl?: string;
}

export default function SubscriptionPanel({
  currentLanguage,
  subscription,
  paymentHistory: paymentHistoryProp,
  onChangePlan,
  onCancelSubscription,
  onViewPricing,
}: SubscriptionPanelProps) {
  const [showCancelFlow, setShowCancelFlow] = useState(false);
  const [cancelStep, setCancelStep] = useState(0);
  const [cancelReason, setCancelReason] = useState('');
  const lang = currentLanguage;

  const plan = subscription ? getPlanConfig(subscription.plan) : null;
  const remaining = daysRemaining(subscription);
  const isTrial = isTrialActive(subscription);

  // Real payment history from Firestore (passed as prop); empty array until data loads
  const paymentHistory: PaymentRecord[] = (paymentHistoryProp ?? []).map(p => ({
    id: p.id,
    date: p.date?.split('T')[0] ?? '',
    amount: Number(p.amount) || 0,
    plan: typeof p.planName === 'object' ? (p.planName[lang] ?? p.plan) : (p.plan ?? ''),
    status: (p.status as 'paid' | 'pending' | 'failed') ?? 'paid',
  }));

  const t = {
    title: lang === 'tr' ? 'Abonelik Yönetimi' : 'Subscription Management',
    currentPlan: lang === 'tr' ? 'Mevcut Plan' : 'Current Plan',
    trial: lang === 'tr' ? 'Deneme Sürümü' : 'Trial',
    active: lang === 'tr' ? 'Aktif' : 'Active',
    daysLeft: lang === 'tr' ? 'gün kaldı' : 'days remaining',
    billingCycle: lang === 'tr' ? 'Fatura Dönemi' : 'Billing Cycle',
    monthly: lang === 'tr' ? 'Aylık' : 'Monthly',
    yearly: lang === 'tr' ? 'Yıllık' : 'Yearly',
    nextBill: lang === 'tr' ? 'Sonraki Fatura' : 'Next Billing',
    users: lang === 'tr' ? 'Kullanıcılar' : 'Users',
    upgrade: lang === 'tr' ? 'Planı Yükselt' : 'Upgrade Plan',
    changePlan: lang === 'tr' ? 'Plan Değiştir' : 'Change Plan',
    cancel: lang === 'tr' ? 'Aboneliği İptal Et' : 'Cancel Subscription',
    paymentHistory: lang === 'tr' ? 'Ödeme Geçmişi' : 'Payment History',
    date: lang === 'tr' ? 'Tarih' : 'Date',
    amount: lang === 'tr' ? 'Tutar' : 'Amount',
    status: lang === 'tr' ? 'Durum' : 'Status',
    invoice: lang === 'tr' ? 'Fatura' : 'Invoice',
    paid: lang === 'tr' ? 'Ödendi' : 'Paid',
    download: lang === 'tr' ? 'İndir' : 'Download',
    noPayments: lang === 'tr' ? 'Henüz ödeme yok' : 'No payments yet',
    cancelTitle: lang === 'tr' ? 'Ayrılmak istediğinize emin misiniz?' : 'Are you sure you want to leave?',
    cancelSubtitle: lang === 'tr'
      ? 'Aboneliğinizi iptal ederseniz dönem sonunda erişiminiz kapatılır.'
      : 'If you cancel, your access will end at the period\'s end.',
    cancelReason: lang === 'tr' ? 'Ayrılma nedeniniz nedir?' : 'Why are you leaving?',
    cancelConfirm: lang === 'tr' ? 'Evet, İptal Et' : 'Yes, Cancel',
    cancelBack: lang === 'tr' ? 'Vazgeç, Kalayım' : 'Never mind, I\'ll stay',
    specialOffer: lang === 'tr' ? 'Özel Teklif: %20 indirimle devam edin!' : 'Special Offer: Continue with 20% off!',
    acceptOffer: lang === 'tr' ? 'Teklifi Kabul Et' : 'Accept Offer',
    noPlan: lang === 'tr' ? 'Aktif aboneliğiniz yok' : 'No active subscription',
    choosePlan: lang === 'tr' ? 'Plan Seçin' : 'Choose a Plan',
    trialBanner: lang === 'tr' ? 'Deneme süreniz devam ediyor' : 'Your trial is active',
  };

  const cancelReasons = lang === 'tr'
    ? ['Çok pahalı', 'İhtiyacım kalmadı', 'Başka bir ürüne geçiyorum', 'Özellikler yetersiz', 'Teknik sorunlar', 'Diğer']
    : ['Too expensive', 'No longer need it', 'Switching to competitor', 'Missing features', 'Technical issues', 'Other'];

  if (!subscription) {
    return (
      <div className="space-y-6">
        <div className="apple-card p-12 text-center">
          <Crown className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-800 mb-2">{t.noPlan}</h3>
          <button onClick={onViewPricing} className="apple-button-primary px-8 mt-4">
            <Zap className="w-4 h-4" /> {t.choosePlan}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Trial banner */}
      {isTrial && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-[#ff4000]/10 to-purple-500/10 border border-[#ff4000]/20 rounded-2xl p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff4000]/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-[#ff4000]" />
            </div>
            <div>
              <p className="font-bold text-gray-800 text-sm">{t.trialBanner}</p>
              <p className="text-gray-500 text-xs">{remaining} {t.daysLeft}</p>
            </div>
          </div>
          <button onClick={onViewPricing} className="apple-button-primary text-xs px-4 py-2">
            {t.upgrade}
          </button>
        </motion.div>
      )}

      {/* Current Plan Card */}
      <div className="apple-card overflow-hidden">
        <div className={`bg-gradient-to-r ${plan?.gradient || 'from-gray-800 to-gray-900'} p-6 sm:p-8 text-white relative overflow-hidden`}>
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1">{t.currentPlan}</p>
              <h3 className="text-2xl font-black flex items-center gap-2">
                {plan?.icon} {plan?.name[lang]}
              </h3>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                  isTrial ? 'bg-amber-400/20 text-amber-300' : 'bg-green-400/20 text-green-300'
                }`}>
                  {isTrial ? t.trial : t.active}
                </span>
                <span className="text-white/40 text-xs">{remaining} {t.daysLeft}</span>
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-3xl font-black">
                {formatPrice(subscription.cycle === 'monthly' ? (plan?.monthlyPrice || 0) : Math.round((plan?.yearlyPrice || 0) / 12), lang)}
              </p>
              <p className="text-white/50 text-xs">/{lang === 'tr' ? 'ay' : 'mo'}</p>
            </div>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <Calendar className="w-5 h-5 text-brand" />
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">{t.billingCycle}</p>
              <p className="text-sm font-bold text-gray-800">{subscription.cycle === 'monthly' ? t.monthly : t.yearly}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <CreditCard className="w-5 h-5 text-brand" />
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">{t.nextBill}</p>
              <p className="text-sm font-bold text-gray-800">{subscription.endDate?.split('T')[0] || '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <Users className="w-5 h-5 text-brand" />
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">{t.users}</p>
              <p className="text-sm font-bold text-gray-800">{subscription.currentUsers} / {subscription.maxUsers}</p>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex flex-wrap gap-3">
          <button onClick={onViewPricing} className="apple-button-primary text-sm px-5 py-2.5">
            <Zap className="w-4 h-4" /> {t.changePlan}
          </button>
          {!isTrial && (
            <button
              onClick={() => { setShowCancelFlow(true); setCancelStep(0); }}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-all"
            >
              {t.cancel}
            </button>
          )}
        </div>
      </div>

      {/* Payment History */}
      <div className="apple-card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-800">{t.paymentHistory}</h3>
        </div>
        {paymentHistory.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">{t.noPayments}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="py-3 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.date}</th>
                  <th className="py-3 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Plan</th>
                  <th className="py-3 px-6 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.amount}</th>
                  <th className="py-3 px-6 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.status}</th>
                  <th className="py-3 px-6 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.invoice}</th>
                </tr>
              </thead>
              <tbody>
                {paymentHistory.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-6 text-gray-700">{p.date}</td>
                    <td className="py-3 px-6 font-bold text-gray-800">{p.plan}</td>
                    <td className="py-3 px-6 text-right font-bold text-gray-900">₺{p.amount.toLocaleString('tr-TR')}</td>
                    <td className="py-3 px-6 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-600">{t.paid}</span>
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button className="text-brand hover:text-brand/80 transition-colors">
                        <Download className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel Flow Modal — Spotify style multi-step */}
      <AnimatePresence>
        {showCancelFlow && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCancelFlow(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative z-10 bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              {cancelStep === 0 && (
                <div className="p-8 text-center">
                  <AlertTriangle className="w-14 h-14 text-amber-500 mx-auto mb-4" />
                  <h3 className="text-xl font-black text-gray-900 mb-2">{t.cancelTitle}</h3>
                  <p className="text-gray-500 text-sm mb-6">{t.cancelSubtitle}</p>
                  <div className="space-y-3">
                    <button
                      onClick={() => setCancelStep(1)}
                      className="w-full py-3 rounded-2xl font-bold text-sm bg-red-500 hover:bg-red-600 text-white transition-all"
                    >
                      {lang === 'tr' ? 'Devam Et' : 'Continue'}
                    </button>
                    <button
                      onClick={() => setShowCancelFlow(false)}
                      className="w-full py-3 rounded-2xl font-bold text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all"
                    >
                      {t.cancelBack}
                    </button>
                  </div>
                </div>
              )}

              {cancelStep === 1 && (
                <div className="p-8">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">{t.cancelReason}</h3>
                  <div className="space-y-2 mb-6">
                    {cancelReasons.map(r => (
                      <button
                        key={r}
                        onClick={() => setCancelReason(r)}
                        className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                          cancelReason === r
                            ? 'border-red-400 bg-red-50 text-red-700'
                            : 'border-gray-100 hover:border-gray-200 text-gray-700'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={() => setCancelStep(2)}
                      disabled={!cancelReason}
                      className="w-full py-3 rounded-2xl font-bold text-sm bg-red-500 hover:bg-red-600 text-white transition-all disabled:opacity-40"
                    >
                      {lang === 'tr' ? 'Devam Et' : 'Continue'}
                    </button>
                    <button
                      onClick={() => setShowCancelFlow(false)}
                      className="w-full py-3 rounded-2xl font-bold text-sm text-gray-500 hover:text-gray-700 transition-all"
                    >
                      {t.cancelBack}
                    </button>
                  </div>
                </div>
              )}

              {cancelStep === 2 && (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-black text-gray-900 mb-2">{t.specialOffer}</h3>
                  <p className="text-gray-500 text-sm mb-6">
                    {lang === 'tr'
                      ? 'Plan değiştirmek yerine %20 indirimle orijinal planınızda kalabilirsiniz.'
                      : 'Instead of cancelling, stay on your original plan with a 20% discount.'}
                  </p>
                  <div className="space-y-3">
                    <button
                      onClick={() => setShowCancelFlow(false)}
                      className="w-full py-3 rounded-2xl font-bold text-sm bg-green-600 hover:bg-green-700 text-white transition-all"
                    >
                      ✨ {t.acceptOffer}
                    </button>
                    <button
                      onClick={() => { onCancelSubscription(); setShowCancelFlow(false); }}
                      className="w-full py-3 rounded-2xl font-bold text-sm text-red-500 hover:text-red-700 transition-all"
                    >
                      {t.cancelConfirm}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
