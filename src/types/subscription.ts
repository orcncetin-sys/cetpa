// ─── Subscription Data Model ─────────────────────────────────────────────────

export type SubscriptionPlan = 'starter' | 'professional' | 'business' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'trial' | 'past_due' | 'cancelled' | 'expired';

export interface UserSubscription {
  plan: SubscriptionPlan;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  startDate: string;        // ISO date
  endDate: string;          // ISO date
  trialEndsAt?: string;     // ISO date — only set during trial
  maxUsers: number;
  currentUsers: number;
  paymentMethod?: string;
  lastPayment?: string;     // ISO date
  cancelledAt?: string;     // ISO date
}

export interface PlanConfig {
  id: SubscriptionPlan;
  name: { tr: string; en: string };
  subtitle: { tr: string; en: string };
  monthlyPrice: number;     // TRY
  yearlyPrice: number;      // TRY (total, not /mo)
  maxUsers: number;
  highlight?: boolean;      // "Most Popular" badge
  gradient: string;         // CSS gradient for card
  icon: string;             // emoji
  features: { tr: string; en: string }[];
  modulesAllowed: string[]; // tab IDs the plan unlocks
  cta: { tr: string; en: string };
  isCustomPricing?: boolean;
}

// ─── Plan Configuration ──────────────────────────────────────────────────────

export const PLANS: PlanConfig[] = [
  {
    id: 'starter',
    name: { tr: 'Başlangıç', en: 'Starter' },
    subtitle: { tr: 'Küçük ekipler için ideal', en: 'Perfect for small teams' },
    monthlyPrice: 999,
    yearlyPrice: 9990,
    maxUsers: 1,
    gradient: 'from-slate-800 to-slate-900',
    icon: '🚀',
    cta: { tr: 'Başlangıç Planı Seç', en: 'Choose Starter' },
    features: [
      { tr: '1 Kullanıcı', en: '1 User' },
      { tr: 'Dashboard & Analitik', en: 'Dashboard & Analytics' },
      { tr: 'CRM & Müşteri Yönetimi', en: 'CRM & Customer Management' },
      { tr: 'Envanter Yönetimi', en: 'Inventory Management' },
      { tr: 'Sipariş Yönetimi', en: 'Order Management' },
      { tr: 'E-posta Desteği', en: 'Email Support' },
    ],
    modulesAllowed: ['dashboard', 'crm', 'inventory', 'orders'],
  },
  {
    id: 'professional',
    name: { tr: 'Profesyonel', en: 'Professional' },
    subtitle: { tr: 'Büyüyen işletmeler için', en: 'For growing businesses' },
    monthlyPrice: 2499,
    yearlyPrice: 24990,
    maxUsers: 5,
    highlight: true,
    gradient: 'from-[#ff4000] to-[#ff6b35]',
    icon: '⚡',
    cta: { tr: 'Profesyonel Planı Seç', en: 'Choose Professional' },
    features: [
      { tr: '5 Kullanıcı', en: '5 Users' },
      { tr: 'Başlangıç planındaki her şey', en: 'Everything in Starter' },
      { tr: 'Muhasebe & Finans', en: 'Accounting & Finance' },
      { tr: 'Lojistik & Depo', en: 'Logistics & Warehouse' },
      { tr: 'Satın Alma', en: 'Purchasing' },
      { tr: 'B2B Bayi Portalı', en: 'B2B Dealer Portal' },
      { tr: 'Raporlar & Analiz', en: 'Reports & Analysis' },
      { tr: 'Öncelikli Destek', en: 'Priority Support' },
    ],
    modulesAllowed: [
      'dashboard', 'crm', 'inventory', 'orders',
      'muhasebe', 'lojistik', 'satin-alma', 'b2b',
      'reports', 'integrations', 'finance',
    ],
  },
  {
    id: 'business',
    name: { tr: 'İşletme', en: 'Business' },
    subtitle: { tr: 'Tam kapsamlı yönetim', en: 'Complete management suite' },
    monthlyPrice: 4999,
    yearlyPrice: 49990,
    maxUsers: 15,
    gradient: 'from-purple-700 to-indigo-900',
    icon: '🏢',
    cta: { tr: 'İşletme Planı Seç', en: 'Choose Business' },
    features: [
      { tr: '15 Kullanıcı', en: '15 Users' },
      { tr: 'Profesyonel planındaki her şey', en: 'Everything in Professional' },
      { tr: 'Üretim Yönetimi', en: 'Production Management' },
      { tr: 'Kalite Kontrol', en: 'Quality Control' },
      { tr: 'İnsan Kaynakları', en: 'Human Resources' },
      { tr: 'Hukuk Modülü', en: 'Legal Module' },
      { tr: 'Proje Yönetimi', en: 'Project Management' },
      { tr: 'Risk Yönetimi', en: 'Risk Management' },
      { tr: 'Kurumsal Yönetişim', en: 'Corporate Governance' },
      { tr: '7/24 Destek', en: '24/7 Support' },
    ],
    modulesAllowed: [
      'dashboard', 'crm', 'inventory', 'orders',
      'muhasebe', 'lojistik', 'satin-alma', 'b2b',
      'reports', 'integrations', 'finance',
      'production', 'kalite', 'ik', 'hukuk', 'proje',
      'risk', 'kurumsal',
    ],
  },
  {
    id: 'enterprise',
    name: { tr: 'Kurumsal', en: 'Enterprise' },
    subtitle: { tr: 'Büyük organizasyonlar için', en: 'For large organizations' },
    monthlyPrice: 0,
    yearlyPrice: 0,
    maxUsers: 999,
    isCustomPricing: true,
    gradient: 'from-amber-600 to-yellow-700',
    icon: '👑',
    cta: { tr: 'İletişime Geçin', en: 'Contact Sales' },
    features: [
      { tr: 'Sınırsız Kullanıcı', en: 'Unlimited Users' },
      { tr: 'İşletme planındaki her şey', en: 'Everything in Business' },
      { tr: 'Özel API Entegrasyonları', en: 'Custom API Integrations' },
      { tr: 'Dedike Hesap Yöneticisi', en: 'Dedicated Account Manager' },
      { tr: 'SLA Garantisi', en: 'SLA Guarantee' },
      { tr: 'On-Premise Seçeneği', en: 'On-Premise Option' },
      { tr: 'Özel Eğitim & Onboarding', en: 'Custom Training & Onboarding' },
    ],
    modulesAllowed: [
      'dashboard', 'crm', 'inventory', 'orders',
      'muhasebe', 'lojistik', 'satin-alma', 'b2b',
      'reports', 'integrations', 'finance',
      'production', 'kalite', 'ik', 'hukuk', 'proje',
      'risk', 'kurumsal', 'admin', 'settings',
    ],
  },
];

// ─── Feature / Module Mapping ────────────────────────────────────────────────

/** All tabs that can appear in the sidebar */
export const ALL_MODULES: { id: string; label: { tr: string; en: string }; icon: string }[] = [
  { id: 'dashboard',    label: { tr: 'Dashboard', en: 'Dashboard' },             icon: '📊' },
  { id: 'crm',          label: { tr: 'CRM & Satış', en: 'CRM & Sales' },        icon: '🤝' },
  { id: 'orders',       label: { tr: 'Siparişler', en: 'Orders' },              icon: '📦' },
  { id: 'inventory',    label: { tr: 'Envanter', en: 'Inventory' },             icon: '📋' },
  { id: 'muhasebe',     label: { tr: 'Muhasebe', en: 'Accounting' },            icon: '💰' },
  { id: 'lojistik',     label: { tr: 'Lojistik', en: 'Logistics' },             icon: '🚛' },
  { id: 'satin-alma',   label: { tr: 'Satın Alma', en: 'Purchasing' },          icon: '🛒' },
  { id: 'b2b',          label: { tr: 'B2B Portal', en: 'B2B Portal' },          icon: '🏪' },
  { id: 'reports',      label: { tr: 'Raporlar', en: 'Reports' },               icon: '📈' },
  { id: 'production',   label: { tr: 'Üretim', en: 'Production' },              icon: '🏭' },
  { id: 'kalite',       label: { tr: 'Kalite', en: 'Quality' },                 icon: '✅' },
  { id: 'ik',           label: { tr: 'İnsan Kaynakları', en: 'HR' },            icon: '👥' },
  { id: 'hukuk',        label: { tr: 'Hukuk', en: 'Legal' },                    icon: '⚖️' },
  { id: 'proje',        label: { tr: 'Projeler', en: 'Projects' },              icon: '📐' },
  { id: 'risk',         label: { tr: 'Risk', en: 'Risk' },                      icon: '🛡️' },
  { id: 'kurumsal',     label: { tr: 'Kurumsal', en: 'Governance' },            icon: '🏛️' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getPlanConfig(planId: SubscriptionPlan): PlanConfig {
  return PLANS.find(p => p.id === planId) || PLANS[0];
}

export function canAccessModule(subscription: UserSubscription | null, tabId: string): boolean {
  // Always allow settings/admin for admin-role users (handled separately)
  if (!subscription) return false;
  if (subscription.status === 'cancelled' || subscription.status === 'expired') return false;

  const plan = getPlanConfig(subscription.plan);
  return plan.modulesAllowed.includes(tabId);
}

export function getRequiredPlan(tabId: string): PlanConfig | null {
  for (const plan of PLANS) {
    if (plan.modulesAllowed.includes(tabId)) return plan;
  }
  return null;
}

export function isTrialActive(subscription: UserSubscription | null): boolean {
  if (!subscription || subscription.status !== 'trial') return false;
  if (!subscription.trialEndsAt) return false;
  return new Date(subscription.trialEndsAt) > new Date();
}

export function daysRemaining(subscription: UserSubscription | null): number {
  if (!subscription) return 0;
  const end = new Date(subscription.endDate);
  const now = new Date();
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function formatPrice(amount: number, lang: 'tr' | 'en' = 'tr'): string {
  if (amount === 0) return lang === 'tr' ? 'Özel Fiyat' : 'Custom';
  return `₺${amount.toLocaleString('tr-TR')}`;
}

export function yearlySavingsPercent(plan: PlanConfig): number {
  if (plan.isCustomPricing) return 0;
  const monthlyTotal = plan.monthlyPrice * 12;
  if (monthlyTotal === 0) return 0;
  return Math.round(((monthlyTotal - plan.yearlyPrice) / monthlyTotal) * 100);
}

/** Create a default trial subscription */
export function createTrialSubscription(plan: SubscriptionPlan = 'professional'): UserSubscription {
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 14);

  return {
    plan,
    cycle: 'monthly',
    status: 'trial',
    startDate: now.toISOString(),
    endDate: trialEnd.toISOString(),
    trialEndsAt: trialEnd.toISOString(),
    maxUsers: getPlanConfig(plan).maxUsers,
    currentUsers: 1,
  };
}
