import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, LayoutDashboard, Zap,
  Package, Truck, Landmark, Users,
  BarChart3, ShieldCheck, Globe,
  Check, X, ChevronRight, MessageSquare,
  Briefcase, Activity, Scale, Building2,
  Code, Database, Moon, Sun
} from 'lucide-react';

interface LandingPageProps {
  currentLanguage: 'tr' | 'en';
  onLoginClick: () => void;
  onTryClick: () => void;
  onDashboardClick?: () => void;
  heroImageUrl: string;
  isLoggedIn: boolean;
  onLanguageToggle: () => void;
  darkMode: boolean;
  onDarkModeToggle: () => void;
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}

export default function LandingPage({
  currentLanguage,
  onLoginClick,
  onTryClick,
  onDashboardClick,
  heroImageUrl,
  isLoggedIn,
  onLanguageToggle,
  darkMode,
  onDarkModeToggle
}: LandingPageProps) {
  const isTR = currentLanguage === 'tr';

  // Shorthand helpers for dark/light conditional classes
  const d = (dark: string, light: string) => darkMode ? dark : light;

  const t = {
    nav: {
      features: isTR ? 'Özellikler' : 'Features',
      solutions: isTR ? 'Çözümler' : 'Solutions',
      pricing: isTR ? 'Fiyatlandırma' : 'Pricing',
      login: isTR ? 'Giriş Yap' : 'Sign In',
      cta: isTR ? 'Hemen Dene' : 'Try Now',
    },
    hero: {
      badge: isTR ? 'Yeni Nesil B2B Ecosystem' : 'Next-Gen B2B Ecosystem',
      title: isTR ? 'İşinizin Dijital Omurgası:' : 'The Digital Backbone of Your Business:',
      titleHighlight: isTR ? 'CETPA Cloud ERP' : 'CETPA Cloud ERP',
      subtitle: isTR ? 'Satış, lojistik, üretim ve muhasebe süreçlerinizi tek bir çatı altında toplayın. Shopify, Mikro ve Luca entegrasyonlarıyla tam uyumlu.' : 'Consolidate sales, logistics, production, and accounting under one roof. Fully compatible with Shopify, Mikro, and Luca integrations.',
      primaryCTA: isTR ? 'Müşteri Paneline Giriş' : 'Access Client Portal',
      secondaryCTA: isTR ? 'Demo Talebi' : 'Request Demo',
    },
    features: [
      {
        icon: LayoutDashboard,
        title: isTR ? 'Akıllı Veri Analitiği' : 'Smart Data Analytics',
        description: isTR ? 'Uçtan uca veri analitiği ile karar alma süreçlerinizi hızlandırın. Finansal özetlerden stok durumuna kadar her şey tek ekranda.' : 'Accelerate decision-making with end-to-end data analytics. Everything from financial summaries to stock levels on one screen.'
      },
      {
        icon: Users,
        title: isTR ? 'Gelişmiş CRM & Satış' : 'Advanced CRM & Sales',
        description: isTR ? 'Müşteri ilişkilerinde eksiksiz takip. Aday müşteri yönetiminden otomatik teklif hazırlamaya kadar satış döngünüzü optimize edin.' : 'Complete customer relationship tracking. Optimize your sales cycle from lead management to automatic quotations.'
      },
      {
        icon: Package,
        title: isTR ? 'Stok & Depo Çözümleri' : 'Stock & Warehouse solutions',
        description: isTR ? 'Karmaşık depo yapılarını kolayca yönetin. Kritik stok uyarıları ve detaylı ürün hayat döngüsü takibi ile maliyetlerinizi düşürün.' : 'Manage complex warehouse structures with ease. Reduce costs with critical stock alerts and detailed product lifecycle tracking.'
      },
      {
        icon: Truck,
        title: isTR ? 'Lojistik & Rotalama' : 'Logistics & Routing',
        description: isTR ? "Yük planlama ve akıllı rotalama modülleriyle sevkiyat maliyetlerini %20'ye kadar düşürün. Entegre kargo takibi." : 'Reduce shipping costs by up to 20% with load planning and smart routing modules. Integrated cargo tracking.'
      },
      {
        icon: Landmark,
        title: isTR ? 'Finans & Muhasebe Sync' : 'Finance & Accounting Sync',
        description: isTR ? 'Mikro ve Luca ile tam entegrasyon. e-Fatura, e-Arşiv ve banka hareketlerini otomatik senkronize ederek hata payını sıfırlayın.' : 'Full integration with Mikro and Luca. Zero errors by automatically syncing e-Invoices, e-Archives and bank transactions.'
      },
      {
        icon: Activity,
        title: isTR ? 'Üretim & Kalite Kontrol' : 'Production & Quality Control',
        description: isTR ? 'İş emirlerinden ürün reçetelerine, ham madde ihtiyaç planlamasından kalite kontrol süreçlerine kadar tüm fabrika operasyonları.' : 'All factory operations from work orders to product recipes, raw material requirement planning to quality control processes.'
      },
      {
        icon: Briefcase,
        title: isTR ? 'İK & Bordro Yönetimi' : 'HR & Payroll Management',
        description: isTR ? 'Dijital personel dosyaları, izin takibi, otomatik bordro hazırlığı ve kurumsal performans ölçümü ile verimliliği artırın.' : 'Increase efficiency with digital personnel files, leave tracking, automatic payroll preparation and corporate performance measurement.'
      },
      {
        icon: Scale,
        title: isTR ? 'Hukuk & Finansal Risk' : 'Legal & Financial Risk',
        description: isTR ? 'Sözleşme hatırlatıcıları, dava takibi ve finansal risk skoru analiziyle markanızı ve nakit akışınızı güvence altına alın.' : 'Secure your brand and cash flow with contract reminders, case tracking and financial risk score analysis.'
      }
    ],
    pricing: {
      title: isTR ? 'Her Ölçek İçin Uygun Plan' : 'Plans for Every Scale',
      subtitle: isTR ? 'İşletmenizin ihtiyaçlarına göre esnek fiyatlandırma seçenekleri.' : 'Flexible pricing options based on your business needs.',
      plans: [
        {
          name: isTR ? 'Startup' : 'Startup',
          price: isTR ? '₺1.490' : '$49',
          features: isTR ? ['CRM & Teklif Yönetimi', 'Stok Takibi', 'Shopify Entegrasyonu', '3 Kullanıcı'] : ['CRM & Quotation', 'Stock Tracking', 'Shopify Integration', '3 Users'],
          cta: isTR ? 'Hemen Başla' : 'Start Now',
          highlight: false
        },
        {
          name: isTR ? 'Enterprise' : 'Enterprise',
          price: isTR ? '₺4.990' : '$149',
          features: isTR ? ['Tüm Modüller Dahil', 'Mikro/Luca Sync', 'Üretim Planlama', 'Sınırsız Kullanıcı'] : ['All Modules Included', 'Mikro/Luca Sync', 'Production Planning', 'Unlimited Users'],
          cta: isTR ? 'Bize Ulaşın' : 'Contact Us',
          highlight: true
        },
        {
          name: isTR ? 'Custom' : 'Custom',
          price: isTR ? 'Teklif Al' : 'Get Quote',
          features: isTR ? ['Özel Geliştirme', 'Yerinde Kurulum', '7/24 VIP Destek', 'Dedicated Sunucu'] : ['Custom Development', 'On-premise Setup', '24/7 VIP Support', 'Dedicated Server'],
          cta: isTR ? 'Teklif İste' : 'Request Quote',
          highlight: false
        }
      ]
    }
  };

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-500 font-avenir overflow-x-hidden",
      darkMode ? "bg-[#0a0a0a] text-[#f5f5f7]" : "bg-white text-[#1D1D1F]"
    )}>
      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300">
        <div className={cn(
          "max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between border-b backdrop-blur-xl",
          darkMode
            ? "border-white/5 bg-[#0a0a0a]/80"
            : "border-black/5 bg-white/60"
        )}>
          <div className="flex items-center gap-10">
            <img src="/cetpalogo.avif" alt="CETPA" className="h-8 w-auto object-contain" />
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className={cn("text-sm font-medium transition-colors", d("text-white/60 hover:text-white", "text-black/60 hover:text-black"))}>{t.nav.features}</a>
              <a href="#pricing" className={cn("text-sm font-medium transition-colors", d("text-white/60 hover:text-white", "text-black/60 hover:text-black"))}>{t.nav.pricing}</a>
              <a href="#solutions" className={cn("text-sm font-medium transition-colors", d("text-white/60 hover:text-white", "text-black/60 hover:text-black"))}>{t.nav.solutions}</a>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <button
              onClick={onLanguageToggle}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all text-xs font-bold outline-none whitespace-nowrap",
                d("bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10", "bg-black/5 border-black/8 text-black/50 hover:text-black hover:bg-black/10")
              )}
            >
              <Globe className="w-3.5 h-3.5" />
              {currentLanguage === 'tr' ? 'EN' : 'TR'}
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={onDarkModeToggle}
              title={darkMode ? (isTR ? 'Açık Mod' : 'Light Mode') : (isTR ? 'Karanlık Mod' : 'Dark Mode')}
              className={cn(
                "flex items-center justify-center w-[38px] h-[38px] rounded-xl border transition-all outline-none flex-shrink-0",
                d("bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10", "bg-black/5 border-black/8 text-black/50 hover:text-black hover:bg-black/10")
              )}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {!isLoggedIn ? (
              <>
                <button onClick={onLoginClick} className={cn("text-sm font-bold transition-colors px-3 py-2 whitespace-nowrap flex-shrink-0", d("text-white/80 hover:text-white", "text-black/80 hover:text-black"))}>{t.nav.login}</button>
                <button onClick={onTryClick} className="bg-brand text-white px-4 py-2.5 rounded-full text-sm font-bold shadow-lg shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all whitespace-nowrap flex-shrink-0">{t.nav.cta}</button>
              </>
            ) : (
              <button onClick={onDashboardClick} className="bg-brand text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-lg shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap">
                <LayoutDashboard className="w-4 h-4" />
                {isTR ? 'Panele Git' : 'Go to Dashboard'}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero Section ── */}
      <section className="relative pt-40 pb-20 overflow-hidden">
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[800px] h-[800px] rounded-full blur-[140px] pointer-events-none bg-brand/5" />
        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-bold tracking-widest text-brand uppercase mb-6", d("bg-white/5 border-white/10", "bg-black/5 border-black/10"))}><Zap className="w-3 h-3" /> {t.hero.badge}</motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-[1.1]">{t.hero.title} <br /> <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand via-[#ff8000] to-orange-400">{t.hero.titleHighlight}</span></motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className={cn("text-lg md:text-xl mb-12 max-w-2xl mx-auto leading-relaxed", d("text-white/50", "text-black/50"))}>{t.hero.subtitle}</motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={isLoggedIn ? onDashboardClick : onLoginClick}
              className={cn("w-full sm:w-auto px-10 py-5 rounded-full font-bold text-lg hover:scale-[1.05] transition-all flex items-center justify-center gap-3 active:scale-95",
                darkMode ? "bg-[#111] text-white border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.7)] hover:bg-[#181818]" : "bg-black text-white shadow-2xl shadow-black/10")}
            >
              {isLoggedIn ? (isTR ? 'Yönetim Paneline Git' : 'Go to Admin Panel') : t.hero.primaryCTA}
              <ArrowRight className="w-5 h-5" />
            </button>
            {!isLoggedIn && (
              <button
                onClick={onTryClick}
                className={cn("w-full sm:w-auto px-10 py-5 border rounded-full font-bold text-lg transition-all",
                  d("bg-white/5 border-white/10 hover:bg-white/10", "bg-black/5 border-black/10 hover:bg-black/10"))}
              >
                {t.hero.secondaryCTA}
              </button>
            )}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8 }} className="relative mt-20">
            <div className={cn("rounded-[2.5rem] border p-2 backdrop-blur-sm overflow-hidden", d("border-white/5 bg-white/5", "border-black/5 bg-black/5"))}>
              <img src={heroImageUrl} alt="CETPA Dashboard" className="rounded-[2rem] w-full h-auto shadow-2xl" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Integration Ecosystem ── */}
      <section className={cn("py-24 border-y", d("border-white/5 bg-white/[0.02]", "border-black/5 bg-black/[0.02]"))}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h3 className="text-xs font-bold tracking-widest text-brand uppercase mb-2">{isTR ? 'TAM ENTEGRASYON ÇÖZÜMLERİ' : 'FULL INTEGRATION SOLUTIONS'}</h3>
            <p className={cn("text-sm max-w-xl mx-auto", d("text-white/40", "text-black/40"))}>{isTR ? 'Mevcut sistemlerinizle kusursuz çalışır, veriyi tek noktadan yönetmenizi sağlar.' : 'Works seamlessly with your existing systems, allowing you to manage data from a single point.'}</p>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-40 grayscale hover:grayscale-0 transition-all duration-700">
            {[
              { label: 'Shopify', icon: LayoutDashboard, color: '#95BF47' },
              { label: 'MIKRO', icon: Code, color: '#ff4000' },
              { label: 'LUCA', icon: Database, color: '#3b82f6' },
              { label: 'GOOGLE', icon: Globe, color: darkMode ? '#ffffff' : '#000000' },
            ].map((eco, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${eco.color}20` }}>
                  <eco.icon className="w-6 h-6" style={{ color: eco.color }} />
                </div>
                <span className="font-bold tracking-tighter text-xl">{eco.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Detailed Features ─ */}
      <section id="features" className="py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-bold mb-4">{isTR ? 'Uçtan Uca Çözümler' : 'End-to-End Solutions'}</h2>
            <p className={d("text-white/40", "text-black/40")}>{isTR ? 'İşletmenizin her departmanı için özel araçlar' : 'Specialized tools for every department of your business'}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.features.map((feature, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: idx * 0.05 }} className={cn("group p-8 rounded-[2rem] border transition-all duration-300 hover:border-brand/30 hover:bg-brand/[0.02]", d("bg-white/[0.02] border-white/5", "bg-black/[0.02] border-black/5"))}>
                <div className="w-12 h-12 rounded-xl bg-brand/10 flex items-center justify-center text-brand mb-6 group-hover:scale-110 transition-transform"><feature.icon className="w-6 h-6" /></div>
                <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                <p className={cn("text-xs leading-relaxed", d("text-white/40", "text-black/40"))}>{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing Section ── */}
      <section id="pricing" className="py-32 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">{t.pricing.title}</h2>
            <p className={d("text-white/40", "text-black/40")}>{t.pricing.subtitle}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {t.pricing.plans.map((plan, i) => (
              <div key={i} className={cn("p-10 rounded-[2.5rem] border transition-all",
                plan.highlight
                  ? darkMode
                    ? "border-brand/50 shadow-2xl shadow-brand/10 scale-105 bg-[#1c1c1e] shadow-xl"
                    : "border-brand/50 shadow-2xl shadow-brand/10 scale-105 bg-white shadow-xl"
                  : darkMode
                    ? "bg-white/[0.02] border-white/10 hover:border-white/20 hover:bg-white/[0.04]"
                    : "bg-black/[0.01] border-black/10 hover:border-black/20 hover:bg-black/[0.02]"
              )}>
                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-8">
                  <span className="text-4xl font-black">{plan.price}</span>
                  {plan.price.includes('₺') && <span className={d("text-white/40", "text-black/40")}>{isTR ? '/ay' : '/mo'}</span>}
                </div>
                <ul className="space-y-4 mb-10">
                  {plan.features.map((f, j) => (
                    <li key={j} className={cn("flex items-center gap-3 text-sm", d("text-white/60", "text-black/60"))}><Check className="w-4 h-4 text-brand" /> {f}</li>
                  ))}
                </ul>
                <button
                  onClick={isLoggedIn ? onDashboardClick : onTryClick}
                  className={cn("w-full py-4 rounded-2xl font-bold transition-all",
                    plan.highlight
                      ? "bg-brand text-white shadow-lg shadow-brand/20"
                      : d("bg-white/10 text-white hover:bg-white/20", "bg-black/10 text-black hover:bg-black/20")
                  )}
                >
                  {isLoggedIn ? (isTR ? 'Panele Dön' : 'Return to Panel') : plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-32">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className={cn("p-16 rounded-[3rem] border relative overflow-hidden group bg-gradient-to-br from-brand/10 to-transparent", d("border-white/5", "border-black/5"))}>
            <div className="absolute top-0 right-0 p-8 scale-150 opacity-10 group-hover:scale-110 transition-transform duration-1000"><Building2 className="w-64 h-64" /></div>
            <h2 className="text-4xl font-bold mb-6">{isTR ? 'Geleceğin ERP Sistemiyle Tanışın' : 'Meet the ERP System of the Future'}</h2>
            <p className={cn("mb-10 max-w-xl mx-auto", d("text-white/40", "text-black/40"))}>{isTR ? 'Tüm süreçlerinizi hızlandırın, maliyetlerinizi azaltın ve ölçeklenmeye başlayın.' : 'Speed up all your processes, reduce costs and start scaling.'}</p>
            <button
              onClick={onTryClick}
              className={cn("px-12 py-5 rounded-full font-bold text-xl hover:scale-105 transition-all shadow-lg",
                darkMode ? "bg-white text-[#0a0a0a] shadow-white/10" : "bg-black text-white shadow-black/10")}
            >
              {isTR ? 'Ücretsiz Deneyin' : 'Try for Free'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={cn("py-20 border-t opacity-40 hover:opacity-100 transition-opacity", d("border-white/5", "border-black/5"))}>
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-10">
          <div className="flex items-center gap-4 text-xs font-bold tracking-widest uppercase">
            <img src="/cetpalogo.avif" alt="CETPA" className="h-4" />
            <span>© 2026 CETPA TECHNOLOGY</span>
          </div>
          <div className="flex items-center gap-8 text-[10px] font-bold uppercase tracking-widest">
            <a href="#" className="hover:text-brand transition-colors">Privacy</a>
            <a href="#" className="hover:text-brand transition-colors">Terms</a>
            <a href="#" className="hover:text-brand transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
