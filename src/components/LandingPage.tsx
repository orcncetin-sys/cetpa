/**
 * LandingPage.tsx — CETPA Cloud ERP — World-class SaaS landing page
 * Claude Design system · Stripe/Linear/Vercel-inspired · 2026
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, useInView, AnimatePresence } from 'motion/react';
import {
  ArrowRight, LayoutDashboard, Zap, Package, Truck, Landmark, Users,
  BarChart3, ShieldCheck, Globe, Check, MessageSquare, Briefcase,
  Activity, Scale, Building2, Code, Database, Moon, Sun,
  TrendingUp, Clock, Play, ChevronDown, Mail, Star,
} from 'lucide-react';
import PrivacyPage from './PrivacyPage';
import TermsPage from './TermsPage';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LandingPageProps {
  currentLanguage: 'tr' | 'en';
  onLoginClick:    () => void;
  onTryClick:      () => void;
  onDashboardClick?: () => void;
  heroImageUrl:    string;
  isLoggedIn:      boolean;
  onLanguageToggle: () => void;
  darkMode:        boolean;
  onDarkModeToggle: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' '); }

// ── Animated Counter ──────────────────────────────────────────────────────────

function Counter({ to, prefix = '', suffix = '', duration = 1800 }: { to: number; prefix?: string; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  useEffect(() => {
    if (!inView) return;
    const steps = 60;
    const inc = to / steps;
    let cur = 0; let i = 0;
    const id = setInterval(() => {
      i++;
      cur = Math.min(Math.round(i * inc), to);
      setVal(cur);
      if (cur >= to) clearInterval(id);
    }, duration / steps);
    return () => clearInterval(id);
  }, [inView, to, duration]);
  return <span ref={ref}>{prefix}{val.toLocaleString()}{suffix}</span>;
}

// ── Sparkle SVG ───────────────────────────────────────────────────────────────

function SparkleIcon({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" style={style}>
      <path d="M8 0 L9.2 6 L16 8 L9.2 10 L8 16 L6.8 10 L0 8 L6.8 6 Z" />
    </svg>
  );
}

// ── Floating Sparkles Background ─────────────────────────────────────────────

function SparkleField({ count = 18, color = '#ff4000' }: { count?: number; color?: string }) {
  const items = useRef(
    Array.from({ length: count }, (_, i) => ({
      id: i,
      top:   `${5 + Math.random() * 88}%`,
      left:  `${2 + Math.random() * 95}%`,
      size:  6 + Math.random() * 10,
      delay: Math.random() * 4,
      dur:   3 + Math.random() * 4,
      opacity: 0.15 + Math.random() * 0.5,
    }))
  ).current;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {items.map(s => (
        <div
          key={s.id}
          className="absolute"
          style={{
            top: s.top, left: s.left,
            color,
            opacity: s.opacity,
            animation: `cetpa-sparkle ${s.dur}s ${s.delay}s ease-in-out infinite`,
          }}
        >
          <SparkleIcon size={s.size} />
        </div>
      ))}
    </div>
  );
}

// ── Scroll Progress Bar ───────────────────────────────────────────────────────

function ScrollBar() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const h = () => {
      const el = document.documentElement;
      setP((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
    };
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[2px] bg-transparent pointer-events-none">
      <div className="h-full bg-gradient-to-r from-brand via-orange-400 to-amber-400 transition-all duration-75" style={{ width: `${p}%` }} />
    </div>
  );
}

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

function FAQItem({ q, a, darkMode }: { q: string; a: string; darkMode: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('border rounded-2xl overflow-hidden transition-colors', darkMode ? 'border-white/8' : 'border-black/8')}>
      <button
        className={cn('w-full flex items-center justify-between px-6 py-5 text-left font-semibold text-sm gap-4', darkMode ? 'hover:bg-white/4' : 'hover:bg-black/3')}
        onClick={() => setOpen(v => !v)}
      >
        {q}
        <ChevronDown className={cn('w-4 h-4 flex-shrink-0 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
            <p className={cn('px-6 pb-6 text-sm leading-relaxed', darkMode ? 'text-white/50' : 'text-black/50')}>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Testimonial Card ──────────────────────────────────────────────────────────

function TestiCard({ quote, name, role, company, rating, darkMode }: { quote: string; name: string; role: string; company: string; rating: number; darkMode: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={cn('p-8 rounded-3xl border flex flex-col gap-5 h-full', darkMode ? 'bg-white/4 border-white/8' : 'bg-white border-black/8 shadow-sm')}
    >
      <div className="flex gap-1">
        {Array.from({ length: rating }).map((_, i) => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
      </div>
      <p className={cn('text-sm leading-relaxed flex-1', darkMode ? 'text-white/70' : 'text-black/70')}>"{quote}"</p>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand to-orange-400 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {name[0]}
        </div>
        <div>
          <p className="font-bold text-sm">{name}</p>
          <p className={cn('text-xs', darkMode ? 'text-white/40' : 'text-black/40')}>{role} · {company}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function LandingPage({
  currentLanguage, onLoginClick, onTryClick, onDashboardClick,
  heroImageUrl, isLoggedIn, onLanguageToggle, darkMode, onDarkModeToggle,
}: LandingPageProps) {
  const isTR = currentLanguage === 'tr';
  const [activePage, setActivePage] = useState<null | 'privacy' | 'terms'>(null);
  const [scrolled, setScrolled] = useState(false);
  const [pricingAnnual, setPricingAnnual] = useState(true);
  const d = (dk: string, lt: string) => darkMode ? dk : lt;

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  if (activePage === 'privacy') return <PrivacyPage currentLanguage={currentLanguage} darkMode={darkMode} onBack={() => { setActivePage(null); window.scrollTo(0, 0); }} />;
  if (activePage === 'terms')   return <TermsPage   currentLanguage={currentLanguage} darkMode={darkMode} onBack={() => { setActivePage(null); window.scrollTo(0, 0); }} />;

  const brand = '#ff4000';

  // ─── Content ────────────────────────────────────────────────────────────────
  const features = [
    { icon: LayoutDashboard, title: isTR ? 'Akıllı Dashboard' : 'Smart Dashboard',        desc: isTR ? 'Gerçek zamanlı KPI\'lar, AI önerileri ve tek ekranda işletme özeti.' : 'Real-time KPIs, AI insights and business summary on one screen.' },
    { icon: Users,           title: isTR ? 'Gelişmiş CRM' : 'Advanced CRM',               desc: isTR ? 'Lead skorlaması, AI destekli tahminler ve müşteri portföy yönetimi.' : 'Lead scoring, AI-powered predictions and customer portfolio management.' },
    { icon: Package,         title: isTR ? 'Stok & Depo' : 'Stock & Warehouse',           desc: isTR ? 'Çok depolu yönetim, barkod okuma, kritik stok uyarıları.' : 'Multi-warehouse management, barcode scanning, critical stock alerts.' },
    { icon: Truck,           title: isTR ? 'Lojistik & Kargo' : 'Logistics & Cargo',      desc: isTR ? 'Akıllı rotalama, kargo takibi ve teslim performans analizi.' : 'Smart routing, cargo tracking and delivery performance analytics.' },
    { icon: Landmark,        title: isTR ? 'Finans & Muhasebe' : 'Finance & Accounting',  desc: isTR ? 'e-Fatura, Mikro/Luca sync, ödeme takibi ve nakit akışı.' : 'e-Invoice, Mikro/Luca sync, payment tracking and cash flow.' },
    { icon: Activity,        title: isTR ? 'Üretim Planlama' : 'Production Planning',     desc: isTR ? 'İş emirleri, BOM yönetimi, kapasite planlaması ve OEE takibi.' : 'Work orders, BOM management, capacity planning and OEE tracking.' },
    { icon: Briefcase,       title: isTR ? 'İK & Bordro' : 'HR & Payroll',                desc: isTR ? 'Dijital personel dosyaları, izin yönetimi, otomatik bordro.' : 'Digital personnel files, leave management, automated payroll.' },
    { icon: Scale,           title: isTR ? 'Hukuk & Risk' : 'Legal & Risk',               desc: isTR ? 'Sözleşme takibi, finansal risk skoru ve hukuki süreç yönetimi.' : 'Contract tracking, financial risk scoring and legal process management.' },
  ];

  const steps = [
    { n: '01', title: isTR ? 'Bağlan' : 'Connect',    desc: isTR ? 'Shopify, Mikro ve Luca hesaplarınızı dakikalar içinde entegre edin.' : 'Integrate Shopify, Mikro and Luca accounts in minutes.', icon: Code },
    { n: '02', title: isTR ? 'Otomatikleştir' : 'Automate', desc: isTR ? 'Faturalama, stok, sipariş ve kargo süreçlerini tek akışa bağlayın.' : 'Connect billing, stock, order and shipping into one automated flow.', icon: Zap },
    { n: '03', title: isTR ? 'Büyü' : 'Grow',         desc: isTR ? 'AI destekli tahminler ve anlık raporlarla rekabette öne geçin.' : 'Get ahead with AI-driven forecasts and real-time reporting.', icon: TrendingUp },
  ];

  const testimonials = [
    { quote: isTR ? 'Sipariş yönetiminde harcadığımız zamanı %60 azalttık. CETPA\'nın Shopify entegrasyonu fatura keserken hayat kurtardı.' : 'We reduced time spent on order management by 60%. CETPA\'s Shopify integration is a lifesaver when invoicing.', name: 'Ahmet Y.', role: isTR ? 'Operasyon Müdürü' : 'Operations Manager', company: 'YapıTrade A.Ş.', rating: 5 },
    { quote: isTR ? 'CRM modülü sayesinde müşteri kaybı %35 düştü. AI lead skorlaması satış ekibimizin önceliklerini doğru belirledi.' : 'Customer churn dropped 35% with the CRM module. AI lead scoring helps our sales team set the right priorities.', name: 'Selin K.', role: isTR ? 'Satış Direktörü' : 'Sales Director', company: 'KozmoTex', rating: 5 },
    { quote: isTR ? 'e-Fatura ve Mikro entegrasyonu muhasebe ekibimizi kurtardı. Artık ay sonu kapanış 3 gün yerine 3 saatte bitiyor.' : 'The e-Invoice and Mikro integration saved our accounting team. Month-end close takes 3 hours now instead of 3 days.', name: 'Murat D.', role: isTR ? 'CFO' : 'CFO', company: 'DeltaCargo', rating: 5 },
  ];

  const faqs = [
    { q: isTR ? 'Kurulum ne kadar sürer?' : 'How long does setup take?', a: isTR ? 'Temel kurulum 1 iş günü içinde tamamlanır. Shopify ve muhasebe entegrasyonlarıyla birlikte tam onboarding ortalama 3-5 gün sürmektedir.' : 'Basic setup is complete within 1 business day. Full onboarding with Shopify and accounting integrations averages 3-5 days.' },
    { q: isTR ? 'Mevcut verilerim korunur mu?' : 'Is my existing data protected?', a: isTR ? 'Evet. CSV ve API yoluyla mevcut ERP, Excel veya muhasebe yazılımlarından tüm verilerinizi içe aktarıyoruz. Veri kaybı yaşanmaz.' : 'Yes. We import all your data from existing ERP, Excel or accounting software via CSV and API. No data loss.' },
    { q: isTR ? 'Hangi entegrasyonlar destekleniyor?' : 'Which integrations are supported?', a: isTR ? 'Shopify, Mikro ERP, Luca Muhasebe, iyzico, Google Maps, 360Dialog WhatsApp ve tüm Türk kargo şirketleri desteklenmektedir.' : 'Shopify, Mikro ERP, Luca Accounting, iyzico, Google Maps, 360Dialog WhatsApp and all Turkish cargo companies are supported.' },
    { q: isTR ? 'Fiyatlandırma esnek midir?' : 'Is pricing flexible?', a: isTR ? 'Evet. Kullanıcı sayısına ve modüle göre özelleştirilmiş teklifler sunuyoruz. Yıllık ödemelerde %20 indirim uygulanır.' : 'Yes. We offer customized quotes based on user count and module selection. Annual payments receive 20% off.' },
    { q: isTR ? 'Teknik destek nasıl çalışır?' : 'How does technical support work?', a: isTR ? 'Enterprise planlarda 7/24 canlı destek ve dedicated hesap yöneticisi sağlanır. Startup planında mesai saatlerinde canlı chat desteği mevcuttur.' : 'Enterprise plans include 24/7 live support and a dedicated account manager. Startup plans include live chat support during business hours.' },
  ];

  const pricingPlans = [
    {
      name: 'Startup',
      monthlyTR: 1490, yearlyTR: 1192,
      monthlyEN: 49,   yearlyEN: 39,
      desc: isTR ? 'Büyüyen işletmeler için' : 'For growing businesses',
      features: isTR
        ? ['CRM & Lead Yönetimi', 'Stok & Sipariş Takibi', 'Shopify Entegrasyonu', 'e-Fatura', '3 Kullanıcı', 'Mesai İçi Destek']
        : ['CRM & Lead Management', 'Stock & Order Tracking', 'Shopify Integration', 'e-Invoice', '3 Users', 'Business Hours Support'],
      highlight: false, cta: isTR ? 'Hemen Başla' : 'Start Now',
    },
    {
      name: 'Enterprise',
      monthlyTR: 4990, yearlyTR: 3992,
      monthlyEN: 149,  yearlyEN: 119,
      desc: isTR ? 'Ölçekli operasyonlar için' : 'For scaled operations',
      badge: isTR ? '🔥 En Popüler' : '🔥 Most Popular',
      features: isTR
        ? ['Tüm Modüller Dahil', 'Mikro & Luca Sync', 'Üretim Planlama', 'İK & Bordro', 'Sınırsız Kullanıcı', '7/24 Öncelikli Destek']
        : ['All Modules Included', 'Mikro & Luca Sync', 'Production Planning', 'HR & Payroll', 'Unlimited Users', '24/7 Priority Support'],
      highlight: true, cta: isTR ? 'Bize Ulaşın' : 'Contact Us',
    },
    {
      name: 'Custom',
      monthlyTR: null, yearlyTR: null,
      monthlyEN: null, yearlyEN: null,
      desc: isTR ? 'Kurumsal & holdingler için' : 'For enterprise & holdings',
      features: isTR
        ? ['Özel Geliştirme', 'Yerinde Kurulum', 'Özel API Entegrasyonları', 'Dedicated Sunucu', 'VIP Hesap Yöneticisi', 'SLA Garantili Destek']
        : ['Custom Development', 'On-premise Setup', 'Custom API Integrations', 'Dedicated Server', 'VIP Account Manager', 'SLA-Guaranteed Support'],
      highlight: false, cta: isTR ? 'Teklif Al' : 'Get Quote',
    },
  ];

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('min-h-screen font-sans overflow-x-hidden transition-colors duration-500', d('bg-[#05050a] text-[#f5f5f7]', 'bg-[#fafafa] text-[#111]'))}>

      {/* CSS keyframes for sparkle + gradient animations */}
      <style>{`
        @keyframes cetpa-sparkle {
          0%,100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
          50%      { opacity: 1; transform: scale(1.1) rotate(20deg); }
        }
        @keyframes cetpa-float {
          0%,100% { transform: translateY(0px); }
          50%      { transform: translateY(-12px); }
        }
        @keyframes cetpa-pulse-ring {
          0%   { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes cetpa-gradient-x {
          0%,100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
        @keyframes cetpa-spin-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes cetpa-marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .cetpa-gradient-text {
          background: linear-gradient(135deg, #ff4000 0%, #ff8c00 50%, #fbbf24 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: cetpa-gradient-x 4s ease infinite;
        }
        .cetpa-float { animation: cetpa-float 6s ease-in-out infinite; }
        .cetpa-marquee-track { animation: cetpa-marquee 28s linear infinite; }
        .cetpa-glow {
          box-shadow: 0 0 0 1px rgba(255,64,0,0.15), 0 8px 32px -8px rgba(255,64,0,0.3), 0 32px 80px -16px rgba(255,64,0,0.15);
        }
        .cetpa-card-glow:hover {
          box-shadow: 0 0 0 1px rgba(255,64,0,0.2), 0 20px 60px -12px rgba(255,64,0,0.15);
        }
        .cetpa-grid-bg {
          background-image: linear-gradient(rgba(255,64,0,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,64,0,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .cetpa-noise::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
          pointer-events: none;
          border-radius: inherit;
        }
      `}</style>

      {/* Scroll progress bar */}
      <ScrollBar />

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <nav className={cn(
        'fixed top-2 left-0 right-0 z-50 transition-all duration-300 px-4',
      )}>
        <div className={cn(
          'max-w-6xl mx-auto flex items-center justify-between h-14 px-5 rounded-2xl border transition-all duration-300',
          scrolled
            ? d('bg-[#0f0f14]/90 border-white/10 backdrop-blur-xl shadow-2xl', 'bg-white/90 border-black/8 backdrop-blur-xl shadow-lg')
            : d('bg-transparent border-transparent', 'bg-transparent border-transparent'),
        )}>
          {/* Logo + nav links */}
          <div className="flex items-center gap-8">
            <img src="/cetpalogo.avif" alt="CETPA" className="h-7 w-auto object-contain" />
            <div className="hidden md:flex items-center gap-6">
              {[
                { id: 'how', label: isTR ? 'Nasıl Çalışır' : 'How It Works' },
                { id: 'features', label: isTR ? 'Özellikler' : 'Features' },
                { id: 'pricing', label: isTR ? 'Fiyatlar' : 'Pricing' },
                { id: 'solutions', label: isTR ? 'Sektörler' : 'Industries' },
              ].map(({ id, label }) => (
                <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
                  className={cn('text-sm font-medium transition-colors', d('text-white/50 hover:text-white', 'text-black/50 hover:text-black'))}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <button onClick={onLanguageToggle}
              className={cn('text-xs font-bold px-2.5 py-1.5 rounded-xl border transition-all', d('border-white/10 text-white/50 hover:text-white hover:bg-white/8', 'border-black/10 text-black/50 hover:text-black hover:bg-black/5'))}>
              {currentLanguage === 'tr' ? 'EN' : 'TR'}
            </button>
            <button onClick={onDarkModeToggle}
              className={cn('w-9 h-9 flex items-center justify-center rounded-xl border transition-all', d('border-white/10 text-white/50 hover:text-white hover:bg-white/8', 'border-black/10 text-black/50 hover:text-black hover:bg-black/5'))}>
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {!isLoggedIn ? (
              <>
                <button onClick={onLoginClick}
                  className={cn('text-sm font-semibold px-4 py-2 transition-colors', d('text-white/70 hover:text-white', 'text-black/70 hover:text-black'))}>
                  {isTR ? 'Giriş' : 'Sign In'}
                </button>
                <button onClick={onTryClick}
                  className="bg-brand text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-orange-500 transition-all shadow-lg shadow-brand/25 active:scale-95">
                  {isTR ? 'Ücretsiz Dene →' : 'Try Free →'}
                </button>
              </>
            ) : (
              <button onClick={onDashboardClick}
                className="bg-brand text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-orange-500 transition-all shadow-lg shadow-brand/25 flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" />
                {isTR ? 'Panele Git' : 'Dashboard'}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className={cn('relative min-h-screen flex flex-col items-center justify-center pt-20 pb-16 overflow-hidden cetpa-grid-bg')}>

        {/* Background orbs */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full blur-[200px] pointer-events-none"
          style={{ background: d('radial-gradient(circle, rgba(255,64,0,0.12) 0%, transparent 70%)', 'radial-gradient(circle, rgba(255,64,0,0.07) 0%, transparent 70%)') }} />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[140px] pointer-events-none"
          style={{ background: d('rgba(255,140,0,0.06)', 'rgba(255,140,0,0.04)') }} />

        {/* Sparkles */}
        <SparkleField count={22} color={d('#ff4000', '#ff6020')} />

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
          {/* Badge */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold tracking-wide mb-8 uppercase', d('bg-white/4 border-white/10 text-white/70', 'bg-black/4 border-black/10 text-black/60'))}>
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            {isTR ? 'Türkiye\'nin #1 B2B Cloud ERP\'si · 200+ aktif müşteri' : 'Turkey\'s #1 B2B Cloud ERP · 200+ active customers'}
          </motion.div>

          {/* Headline */}
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.05] mb-6">
            {isTR ? (
              <>İşletmenizin<br />
                <span className="cetpa-gradient-text">Dijital Omurgası</span>
              </>
            ) : (
              <>Your Business<br />
                <span className="cetpa-gradient-text">Digital Backbone</span>
              </>
            )}
          </motion.h1>

          {/* Subtitle */}
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className={cn('text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto', d('text-white/50', 'text-black/50'))}>
            {isTR
              ? 'Satış, lojistik, üretim ve muhasebe süreçlerinizi tek platformda yönetin. Shopify, Mikro ve Luca ile tam entegrasyon.'
              : 'Manage sales, logistics, production and accounting on one platform. Full integration with Shopify, Mikro and Luca.'}
          </motion.p>

          {/* CTAs */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
            <button onClick={isLoggedIn ? onDashboardClick : onTryClick}
              className="group w-full sm:w-auto px-8 py-4 rounded-2xl bg-brand text-white font-bold text-base shadow-2xl shadow-brand/30 hover:bg-orange-500 hover:scale-[1.03] transition-all active:scale-95 flex items-center justify-center gap-3">
              {isLoggedIn ? (isTR ? 'Panele Git' : 'Go to Dashboard') : (isTR ? 'Ücretsiz Başla' : 'Start for Free')}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <button onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}
              className={cn('w-full sm:w-auto px-8 py-4 rounded-2xl font-bold text-base border transition-all flex items-center justify-center gap-2.5 hover:scale-[1.02]',
                d('border-white/12 bg-white/5 text-white hover:bg-white/10', 'border-black/12 bg-white text-black hover:bg-gray-50 shadow-sm'))}>
              <Play className="w-4 h-4" />
              {isTR ? 'Demo İzle' : 'Watch Demo'}
            </button>
          </motion.div>

          {/* Trust line */}
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            className={cn('text-xs', d('text-white/30', 'text-black/30'))}>
            {isTR ? '✓ Kredi kartı gerekmez · ✓ 14 gün ücretsiz · ✓ İstediğiniz zaman iptal' : '✓ No credit card · ✓ 14-day free trial · ✓ Cancel anytime'}
          </motion.p>

          {/* Hero image with floating stat cards */}
          <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.4 }} className="relative mt-16">

            {/* Glow ring */}
            <div className="absolute inset-0 rounded-[2.5rem] blur-2xl scale-95 opacity-30 pointer-events-none"
              style={{ background: 'linear-gradient(135deg, rgba(255,64,0,0.4) 0%, rgba(255,140,0,0.2) 100%)' }} />

            {/* Browser chrome mockup */}
            <div className={cn('relative rounded-[2rem] border overflow-hidden cetpa-glow cetpa-noise', d('border-white/8 bg-[#111118]', 'border-black/8 bg-white'))}>
              {/* Browser bar */}
              <div className={cn('flex items-center gap-2 px-4 h-10 border-b', d('border-white/6 bg-white/3', 'border-black/6 bg-gray-50'))}>
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400/80" />
                  <div className="w-3 h-3 rounded-full bg-amber-400/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-400/80" />
                </div>
                <div className={cn('flex-1 mx-4 h-5 rounded-md text-[10px] flex items-center px-3 font-mono', d('bg-white/5 text-white/30', 'bg-black/5 text-black/30'))}>
                  app.cetpa.io/dashboard
                </div>
              </div>
              <img src={heroImageUrl} alt="CETPA Dashboard" className="w-full h-auto block" />
            </div>

            {/* Floating stat card — top left */}
            <div className={cn('absolute -left-6 top-1/4 cetpa-float rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl hidden sm:block', d('bg-[#111]/90 border-white/10 text-white', 'bg-white/95 border-black/8 text-black'))}
              style={{ animationDelay: '0s', animationDuration: '5s' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-[10px] font-bold opacity-50 uppercase tracking-wide">{isTR ? 'Bu Ay Ciro' : 'Monthly Revenue'}</p>
                  <p className="text-sm font-black">₺2.4M</p>
                </div>
              </div>
            </div>

            {/* Floating stat card — top right */}
            <div className={cn('absolute -right-6 top-16 cetpa-float rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl hidden sm:block', d('bg-[#111]/90 border-white/10 text-white', 'bg-white/95 border-black/8 text-black'))}
              style={{ animationDelay: '1.5s', animationDuration: '6s' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-brand/15 flex items-center justify-center">
                  <Package className="w-4 h-4 text-brand" />
                </div>
                <div>
                  <p className="text-[10px] font-bold opacity-50 uppercase tracking-wide">{isTR ? 'Aktif Sipariş' : 'Active Orders'}</p>
                  <p className="text-sm font-black">1,247</p>
                </div>
              </div>
            </div>

            {/* Floating stat card — bottom right */}
            <div className={cn('absolute -right-4 bottom-16 cetpa-float rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl hidden lg:block', d('bg-[#111]/90 border-white/10 text-white', 'bg-white/95 border-black/8 text-black'))}
              style={{ animationDelay: '3s', animationDuration: '7s' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-[10px] font-bold opacity-50 uppercase tracking-wide">{isTR ? 'AI Lead Skoru' : 'AI Lead Score'}</p>
                  <p className="text-sm font-black">94 / 100</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Marquee stats bar ──────────────────────────────────────────────── */}
      <div className={cn('relative py-5 border-y overflow-hidden', d('border-white/6 bg-white/[0.025]', 'border-black/6 bg-black/[0.025]'))}>
        <div className="flex w-full overflow-hidden">
          <div className="cetpa-marquee-track flex gap-16 whitespace-nowrap will-change-transform">
            {[...Array(2)].map((_, rep) => (
              <div key={rep} className="flex gap-16 items-center">
                {[
                  { label: isTR ? '200+ müşteri' : '200+ Clients', val: '200+' },
                  { label: isTR ? 'işlenen ciro' : 'Revenue Processed', val: '₺2B+' },
                  { label: isTR ? 'aylık sipariş' : 'Monthly Orders', val: '50K+' },
                  { label: isTR ? 'çalışma süresi' : 'Uptime', val: '99.9%' },
                  { label: isTR ? 'entegrasyon' : 'Integrations', val: '15+' },
                  { label: isTR ? 'destek puanı' : 'Support Score', val: '4.9★' },
                ].map((s, i) => (
                  <div key={i} className="flex items-center gap-3 flex-shrink-0">
                    <SparkleIcon size={10} style={{ color: brand, opacity: 0.5 }} />
                    <span className={cn('text-sm font-black', d('text-white', 'text-black'))}>{s.val}</span>
                    <span className={cn('text-xs', d('text-white/40', 'text-black/40'))}>{s.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Integrations logos ─────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className={cn('text-xs font-bold uppercase tracking-widest mb-10', d('text-white/25', 'text-black/25'))}>
            {isTR ? 'Entegre olduğumuz platformlar' : 'Platforms we integrate with'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-10 md:gap-16">
            {[
              { label: 'Shopify',  color: '#96bf48', icon: LayoutDashboard },
              { label: 'MIKRO',    color: brand,     icon: Code             },
              { label: 'LUCA',     color: '#3b82f6', icon: Database         },
              { label: 'iyzico',   color: '#1c7dda', icon: Landmark         },
              { label: 'WhatsApp', color: '#25d366', icon: MessageSquare    },
              { label: 'Google',   color: '#ea4335', icon: Globe            },
            ].map((eco, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}
                className={cn('flex items-center gap-2.5 transition-all duration-500 grayscale hover:grayscale-0', d('opacity-30 hover:opacity-100', 'opacity-40 hover:opacity-100'))}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${eco.color}20` }}>
                  <eco.icon className="w-4 h-4" style={{ color: eco.color }} />
                </div>
                <span className="font-bold text-base tracking-tight">{eco.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how" className={cn('py-32 relative overflow-hidden', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <SparkleField count={8} color={brand} />
        <div className="max-w-5xl mx-auto px-6 relative z-10">
          <div className="text-center mb-20">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Nasıl Çalışır' : 'How It Works'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'Üç adımda dijital dönüşüm' : 'Three steps to digital transformation'}
            </h2>
            <p className={cn('max-w-xl mx-auto', d('text-white/40', 'text-black/40'))}>
              {isTR ? 'Karmaşık kurulum yok. Hemen başlayın, aynı gün verim alın.' : 'No complex setup. Start immediately, get results the same day.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-14 left-[33%] right-[33%] h-px" style={{ background: `linear-gradient(90deg, transparent, ${brand}40, transparent)` }} />

            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                  className={cn('relative p-8 rounded-3xl border text-center transition-all cetpa-card-glow', d('bg-white/3 border-white/8 hover:bg-white/6', 'bg-white border-black/8 hover:border-brand/20 shadow-sm'))}>
                  <div className="relative inline-flex mb-6">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg"
                      style={{ background: `linear-gradient(135deg, ${brand}, #ff8c00)` }}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className={cn('absolute -top-2 -right-2 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center', d('bg-white/10 text-white/50', 'bg-gray-100 text-black/40'))}>{s.n}</span>
                  </div>
                  <h3 className="text-xl font-black mb-3">{s.title}</h3>
                  <p className={cn('text-sm leading-relaxed', d('text-white/40', 'text-black/40'))}>{s.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Özellikler' : 'Features'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'İşletmenizin her yönü kapsandı' : 'Every aspect of your business covered'}
            </h2>
            <p className={cn('max-w-xl mx-auto', d('text-white/40', 'text-black/40'))}>
              {isTR ? 'Modüler yapı sayesinde sadece ihtiyacınız olan özellikleri aktif edin.' : 'Activate only the features you need thanks to the modular architecture.'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 4) * 0.07 }}
                  className={cn('group p-7 rounded-3xl border transition-all duration-300 cursor-default cetpa-card-glow', d('bg-white/[0.025] border-white/8 hover:bg-white/[0.05] hover:border-brand/20', 'bg-white border-black/8 hover:border-brand/20 shadow-sm hover:shadow-brand/10'))}>
                  <div className="w-11 h-11 rounded-2xl bg-brand/10 flex items-center justify-center text-brand mb-5 group-hover:scale-110 group-hover:bg-brand/20 transition-all duration-300">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm mb-2">{f.title}</h3>
                  <p className={cn('text-xs leading-relaxed', d('text-white/40', 'text-black/40'))}>{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Demo video ───────────────────────────────────────────────────── */}
      <section id="demo" className={cn('py-32 relative overflow-hidden', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: d('radial-gradient(ellipse at center, rgba(255,64,0,0.06) 0%, transparent 70%)', 'radial-gradient(ellipse at center, rgba(255,64,0,0.04) 0%, transparent 70%)') }} />
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10">
          <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Ürün Demosu' : 'Product Demo'}</p>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            {isTR ? 'CETPA\'yı aksiyonda görün' : 'See CETPA in action'}
          </h2>
          <p className={cn('max-w-xl mx-auto mb-12', d('text-white/40', 'text-black/40'))}>
            {isTR ? '4 dakikalık tur ile tüm modülleri keşfedin.' : 'Discover all modules in a 4-minute tour.'}
          </p>

          {/* Video placeholder */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className={cn('relative rounded-3xl border overflow-hidden cursor-pointer group', d('border-white/8', 'border-black/8'))}>
            <img src={heroImageUrl} alt="Demo" className="w-full h-auto blur-[1px] group-hover:blur-0 transition-all duration-500 brightness-75 group-hover:brightness-90" />
            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <button onClick={onTryClick}
                className="relative w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all duration-300 group-hover:bg-brand">
                {/* Pulse rings */}
                <div className="absolute inset-0 rounded-full bg-white/30" style={{ animation: 'cetpa-pulse-ring 2s ease-out infinite' }} />
                <div className="absolute inset-0 rounded-full bg-white/20" style={{ animation: 'cetpa-pulse-ring 2s 0.5s ease-out infinite' }} />
                <Play className="w-8 h-8 text-brand group-hover:text-white transition-colors ml-1" />
              </button>
            </div>
            {/* Duration badge */}
            <div className="absolute bottom-4 right-4 bg-black/70 text-white text-xs font-bold px-3 py-1.5 rounded-xl backdrop-blur-sm flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> 4:12
            </div>
          </motion.div>

          {/* Metric counters below video */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16">
            {[
              { label: isTR ? 'Aktif Müşteri' : 'Active Clients',     to: 200,  suffix: '+',   prefix: '' },
              { label: isTR ? 'İşlenen Ciro' : 'Revenue Processed',   to: 2,    suffix: 'B+ ₺',prefix: '' },
              { label: isTR ? 'Aylık Sipariş' : 'Monthly Orders',     to: 50,   suffix: 'K+',  prefix: '' },
              { label: isTR ? 'Ortalama Puan' : 'Avg. Rating',        to: 4,    suffix: '.9★',  prefix: '' },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={cn('p-6 rounded-2xl border text-center', d('bg-white/3 border-white/8', 'bg-white border-black/8 shadow-sm'))}>
                <p className="text-3xl font-black text-brand">
                  <Counter to={s.to} prefix={s.prefix} suffix={s.suffix} />
                </p>
                <p className={cn('text-xs mt-1 font-medium', d('text-white/40', 'text-black/40'))}>{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section className="py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Müşteri Hikayeleri' : 'Customer Stories'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'Müşterilerimiz ne diyor' : 'What our customers say'}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <TestiCard key={i} {...t} darkMode={darkMode} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className={cn('py-32 relative overflow-hidden', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <SparkleField count={10} color={brand} />
        <div className="max-w-5xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Fiyatlandırma' : 'Pricing'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'Her ölçek için doğru plan' : 'The right plan for every scale'}
            </h2>
            {/* Billing toggle */}
            <div className="inline-flex items-center gap-3 mt-6">
              <span className={cn('text-sm font-semibold', !pricingAnnual && d('text-white/70', 'text-black/70'))}>
                {isTR ? 'Aylık' : 'Monthly'}
              </span>
              <button onClick={() => setPricingAnnual(v => !v)}
                className={cn('relative w-12 h-6 rounded-full transition-colors', pricingAnnual ? 'bg-brand' : d('bg-white/15', 'bg-black/15'))}>
                <div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', pricingAnnual ? 'translate-x-7' : 'translate-x-1')} />
              </button>
              <span className={cn('text-sm font-semibold flex items-center gap-2', pricingAnnual && 'text-brand')}>
                {isTR ? 'Yıllık' : 'Annual'}
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', pricingAnnual ? 'bg-brand/15 text-brand' : d('bg-white/8 text-white/40', 'bg-black/8 text-black/40'))}>
                  {isTR ? '%20 tasarruf' : '20% off'}
                </span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pricingPlans.map((plan, i) => {
              const price = isTR
                ? (pricingAnnual ? plan.yearlyTR : plan.monthlyTR)
                : (pricingAnnual ? plan.yearlyEN : plan.monthlyEN);
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                  className={cn('relative p-8 rounded-3xl border transition-all cetpa-card-glow',
                    plan.highlight
                      ? cn('cetpa-glow', d('bg-[#141419] border-brand/30', 'bg-white border-brand/25 shadow-xl'))
                      : d('bg-white/[0.025] border-white/8 hover:bg-white/[0.05]', 'bg-white border-black/8 hover:border-brand/15 shadow-sm')
                  )}>
                  {plan.highlight && (
                    <div className="absolute -top-px left-0 right-0 h-px rounded-t-3xl" style={{ background: 'linear-gradient(90deg, transparent, #ff4000, transparent)' }} />
                  )}
                  {plan.badge && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand text-white text-[10px] font-black px-4 py-1.5 rounded-full shadow-lg shadow-brand/30 whitespace-nowrap">
                      {plan.badge}
                    </div>
                  )}
                  <h3 className="text-xl font-black mb-1">{plan.name}</h3>
                  <p className={cn('text-xs mb-6', d('text-white/40', 'text-black/40'))}>{plan.desc}</p>
                  <div className="mb-8">
                    {price !== null ? (
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-black">{isTR ? '₺' : '$'}{price?.toLocaleString()}</span>
                        <span className={cn('text-sm', d('text-white/40', 'text-black/40'))}>{isTR ? '/ay' : '/mo'}</span>
                      </div>
                    ) : (
                      <span className="text-3xl font-black">{isTR ? 'Teklif Al' : 'Get Quote'}</span>
                    )}
                    {pricingAnnual && price !== null && (
                      <p className="text-xs text-brand mt-1 font-semibold">{isTR ? 'Yıllık fatura ile' : 'Billed annually'}</p>
                    )}
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((f, j) => (
                      <li key={j} className={cn('flex items-center gap-3 text-sm', d('text-white/60', 'text-black/60'))}>
                        <div className="w-4 h-4 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
                          <Check className="w-2.5 h-2.5 text-brand" />
                        </div>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={isLoggedIn ? onDashboardClick : onTryClick}
                    className={cn('w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-95',
                      plan.highlight
                        ? 'bg-brand text-white hover:bg-orange-500 shadow-lg shadow-brand/25'
                        : d('bg-white/8 text-white hover:bg-white/15', 'bg-black/6 text-black hover:bg-black/12'))}>
                    {isLoggedIn ? (isTR ? 'Panele Dön' : 'Return to Panel') : plan.cta}
                  </button>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Industries ───────────────────────────────────────────────────── */}
      <section id="solutions" className="py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Sektörler' : 'Industries'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'Her sektöre özel çözüm' : 'Custom solutions for every industry'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Truck,       label: isTR ? 'Otomotiv & Yan Sanayi' : 'Automotive & OEM',       desc: isTR ? 'Tedarik zinciri, FMEA, üretim izleme' : 'Supply chain, FMEA, production tracking' },
              { icon: Building2,  label: isTR ? 'İnşaat & Gayrimenkul' : 'Construction & Real Estate', desc: isTR ? 'Proje maliyet kontrolü, alt yüklenici' : 'Project cost control, subcontractors' },
              { icon: Package,    label: isTR ? 'Tekstil & Hazır Giyim' : 'Textile & Apparel',       desc: isTR ? 'Varyant yönetimi, beden-renk stok' : 'Variant management, size-colour inventory' },
              { icon: ShieldCheck,label: isTR ? 'Gıda & İçecek' : 'Food & Beverage',                 desc: isTR ? 'Lot takibi, son kullanma, kalite kontrol' : 'Lot tracking, expiry & quality control' },
              { icon: Globe,      label: isTR ? 'İhracat & Dış Ticaret' : 'Export & Trade',           desc: isTR ? 'Döviz yönetimi, gümrük, lojistik' : 'FX management, customs, logistics' },
              { icon: BarChart3,  label: isTR ? 'Teknoloji & Yazılım' : 'Technology & Software',     desc: isTR ? 'Proje bazlı faturalama, kaynak planlama' : 'Project-based billing, resource planning' },
            ].map(({ icon: Icon, label, desc }, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}
                className={cn('p-6 rounded-3xl border group hover:scale-[1.02] transition-all duration-300 cursor-default cetpa-card-glow', d('bg-white/[0.025] border-white/8 hover:bg-white/[0.05] hover:border-brand/20', 'bg-white border-black/8 hover:border-brand/20 shadow-sm'))}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform" style={{ backgroundColor: 'rgba(255,64,0,0.1)' }}>
                  <Icon className="w-5 h-5" style={{ color: brand }} />
                </div>
                <h3 className="font-bold mb-1.5 text-sm">{label}</h3>
                <p className={cn('text-xs leading-relaxed', d('text-white/40', 'text-black/40'))}>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className={cn('py-32', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <div className="max-w-2xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">FAQ</p>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight">
              {isTR ? 'Sık sorulan sorular' : 'Frequently asked questions'}
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} darkMode={darkMode} />)}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="py-32 px-4">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="relative rounded-[3rem] overflow-hidden p-16 md:p-24 text-center cetpa-noise"
            style={{ background: d('linear-gradient(135deg, #0f0a08 0%, #1a0800 30%, #0f0a08 100%)', 'linear-gradient(135deg, #fff5f0 0%, #fff0e8 50%, #fff5f0 100%)') }}>

            {/* Gradient border */}
            <div className="absolute inset-0 rounded-[3rem] pointer-events-none" style={{ background: 'linear-gradient(135deg, rgba(255,64,0,0.3) 0%, transparent 50%, rgba(255,140,0,0.2) 100%)', WebkitMask: 'padding-box, border-box', padding: '1px' }} />

            {/* Sparkles inside CTA */}
            <SparkleField count={16} color={brand} />

            {/* Glow */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, rgba(255,64,0,0.15) 0%, transparent 60%)' }} />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 bg-brand/15 border border-brand/25 text-brand text-xs font-bold px-4 py-2 rounded-full mb-8 uppercase tracking-wide">
                <SparkleIcon size={10} />
                {isTR ? 'Hemen başlayın' : 'Start today'}
              </div>
              <h2 className={cn('text-4xl md:text-6xl font-black tracking-tight mb-6 leading-tight', d('text-white', 'text-[#111]'))}>
                {isTR ? (
                  <>Dijital dönüşümünüze<br /><span className="cetpa-gradient-text">bugün başlayın</span></>
                ) : (
                  <>Start your digital<br /><span className="cetpa-gradient-text">transformation today</span></>
                )}
              </h2>
              <p className={cn('text-lg mb-10 max-w-xl mx-auto', d('text-white/50', 'text-black/50'))}>
                {isTR ? '14 gün ücretsiz, kredi kartı gerekmez. İstediğiniz zaman iptal edin.' : '14 days free, no credit card required. Cancel anytime.'}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={isLoggedIn ? onDashboardClick : onTryClick}
                  className="group w-full sm:w-auto px-10 py-5 rounded-2xl bg-brand text-white font-black text-lg shadow-2xl shadow-brand/40 hover:bg-orange-500 hover:scale-105 transition-all active:scale-95 flex items-center justify-center gap-3">
                  {isTR ? 'Ücretsiz Başla' : 'Start for Free'}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <a href="mailto:info@cetpa.io"
                  className={cn('w-full sm:w-auto px-10 py-5 rounded-2xl font-bold text-lg border transition-all hover:scale-105 flex items-center justify-center gap-3', d('border-white/15 text-white hover:bg-white/8', 'border-black/12 text-black hover:bg-black/5'))}>
                  <Mail className="w-5 h-5" />
                  {isTR ? 'Demo Talebi' : 'Request Demo'}
                </a>
              </div>
              <p className={cn('text-xs mt-6', d('text-white/25', 'text-black/25'))}>
                {isTR ? 'veya bizi arayın: +90 212 000 00 00' : 'or call us: +90 212 000 00 00'}
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className={cn('border-t pt-16 pb-10', d('border-white/6', 'border-black/6'))}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <img src="/cetpalogo.avif" alt="CETPA" className="h-7 mb-4" />
              <p className={cn('text-xs leading-relaxed mb-4', d('text-white/35', 'text-black/35'))}>
                {isTR ? 'Türkiye\'nin lider B2B Cloud ERP platformu.' : "Turkey's leading B2B Cloud ERP platform."}
              </p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className={cn('text-xs', d('text-white/30', 'text-black/30'))}>99.9% uptime</span>
              </div>
            </div>
            {/* Product */}
            <div>
              <p className={cn('text-xs font-black uppercase tracking-wider mb-4', d('text-white/25', 'text-black/25'))}>{isTR ? 'Ürün' : 'Product'}</p>
              <div className="space-y-3">
                {[isTR ? 'Özellikler' : 'Features', isTR ? 'Fiyatlar' : 'Pricing', 'Changelog', 'API'].map((l, i) => (
                  <button key={i} onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                    className={cn('block text-xs transition-colors', d('text-white/35 hover:text-white', 'text-black/35 hover:text-black'))}>{l}</button>
                ))}
              </div>
            </div>
            {/* Company */}
            <div>
              <p className={cn('text-xs font-black uppercase tracking-wider mb-4', d('text-white/25', 'text-black/25'))}>{isTR ? 'Şirket' : 'Company'}</p>
              <div className="space-y-3">
                {[isTR ? 'Hakkımızda' : 'About', isTR ? 'Kariyer' : 'Careers', 'Blog', isTR ? 'Basın' : 'Press'].map((l, i) => (
                  <span key={i} className={cn('block text-xs', d('text-white/35', 'text-black/35'))}>{l}</span>
                ))}
              </div>
            </div>
            {/* Legal + contact */}
            <div>
              <p className={cn('text-xs font-black uppercase tracking-wider mb-4', d('text-white/25', 'text-black/25'))}>{isTR ? 'Yasal' : 'Legal'}</p>
              <div className="space-y-3">
                <button onClick={() => { setActivePage('privacy'); window.scrollTo(0, 0); }}
                  className={cn('block text-xs transition-colors', d('text-white/35 hover:text-white', 'text-black/35 hover:text-black'))}>
                  {isTR ? 'Gizlilik Politikası' : 'Privacy Policy'}
                </button>
                <button onClick={() => { setActivePage('terms'); window.scrollTo(0, 0); }}
                  className={cn('block text-xs transition-colors', d('text-white/35 hover:text-white', 'text-black/35 hover:text-black'))}>
                  {isTR ? 'Kullanım Koşulları' : 'Terms of Service'}
                </button>
                <a href="mailto:info@cetpa.io" className={cn('block text-xs transition-colors', d('text-white/35 hover:text-white', 'text-black/35 hover:text-black'))}>
                  info@cetpa.io
                </a>
              </div>
            </div>
          </div>

          <div className={cn('pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4', d('border-white/6', 'border-black/6'))}>
            <p className={cn('text-xs', d('text-white/20', 'text-black/20'))}>© 2026 CETPA Technology. {isTR ? 'Tüm hakları saklıdır.' : 'All rights reserved.'}</p>
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', d('text-white/20', 'text-black/20'))}>{isTR ? 'ile yapıldı' : 'Made with'}</span>
              <span className="text-brand">❤</span>
              <span className={cn('text-xs', d('text-white/20', 'text-black/20'))}>{isTR ? 'İstanbul\'da' : 'in Istanbul'}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
