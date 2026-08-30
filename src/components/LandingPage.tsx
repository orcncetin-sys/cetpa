/**
 * LandingPage.tsx — CETPA Cloud ERP — World-class SaaS landing page
 * Claude Design system · SAP-inspired corporate sections · 2026
 */

import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, useInView, AnimatePresence } from 'motion/react';
import {
  ArrowRight, LayoutDashboard, Zap, Package, Truck, Landmark, Users,
  BarChart3, ShieldCheck, Globe, Check, MessageSquare, Briefcase,
  Activity, Scale, Building2, Code, Database, Moon, Sun,
  TrendingUp, Play, Pause, ChevronDown, Mail, Star, X, Minus, Menu as MenuIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PUBLIC_PATHS } from '../lib/publicPaths';
import { db } from '../firebase';
import { collection, doc, onSnapshot, query, addDoc, serverTimestamp } from '../lib/dbClient';
import { byField } from '../utils/fsSort';

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

// ── ICP Persona Selector ──────────────────────────────────────────────────────

interface SectionProps {
  isTR: boolean;
  d: (dk: string, lt: string) => string;
  darkMode: boolean;
}

const PERSONAS = [
  {
    key: 'sme',
    labelTR: 'Küçük İşletme',
    labelEN: 'SME',
    icon: '🏪',
    bulletsTR: [
      'Kurulum yok — tarayıcıdan anında kullanmaya başla',
      'Fatura, stok ve siparişi tek ekranda yönet',
      'Büyüdükçe planını yükselt, fazla ödeme yok',
    ],
    bulletsEN: [
      'No setup — start instantly from your browser',
      'Manage invoices, inventory and orders in one view',
      'Upgrade your plan as you grow, no overpaying',
    ],
  },
  {
    key: 'exporter',
    labelTR: 'İhracatçı',
    labelEN: 'Exporter',
    icon: '🌍',
    bulletsTR: [
      'Çok para birimli fatura ve döviz kurları otomatik güncellenir',
      'Gümrük & nakliye belgelerini tek tıkla PDF olarak al',
      'Müşteri başına kredi limiti ve vade takibi',
    ],
    bulletsEN: [
      'Multi-currency invoicing with automatic FX rate updates',
      'Export customs & shipping docs as PDF in one click',
      'Per-customer credit limit & payment terms tracking',
    ],
  },
  {
    key: 'manufacturer',
    labelTR: 'Üretici',
    labelEN: 'Manufacturer',
    icon: '🏭',
    bulletsTR: [
      'BOM ve üretim emirleri ile hammadde planlaması',
      'Lot / seri numarası takibi ve kalite kontrol adımları',
      'Tedarikçi sipariş ve teslim sürelerini otomatik izle',
    ],
    bulletsEN: [
      'BOM & production orders for raw material planning',
      'Lot / serial number tracking with quality control steps',
      'Automatically monitor supplier orders and lead times',
    ],
  },
  {
    key: 'accountant',
    labelTR: 'Muhasebeci Partner',
    labelEN: 'Accountant Partner',
    icon: '🧾',
    bulletsTR: [
      'Birden fazla müşteriyi tek hesaptan yönet',
      'e-Fatura & e-Arşiv entegrasyonu hazır',
      'Dönem sonu raporlarını Excel / PDF olarak saniyeler içinde al',
    ],
    bulletsEN: [
      'Manage multiple clients from a single account',
      'e-Invoice & e-Archive integration ready out of the box',
      'Pull period-end reports as Excel / PDF in seconds',
    ],
  },
];

function IcpSection({ isTR, d, darkMode }: SectionProps) {
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const active = PERSONAS.find(p => p.key === selectedPersona) ?? null;

  return (
    <section className={cn('py-24', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
      <div className="w-full max-w-5xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">
              {isTR ? 'Kişiselleştirilmiş Deneyim' : 'Personalised Experience'}
            </p>
            <h2 className={cn('text-3xl md:text-4xl font-black tracking-tight', d('text-white', 'text-[#111]'))}>
              {isTR ? 'Cetpa sizin için nasıl çalışır?' : 'How does Cetpa work for you?'}
            </h2>
            <p className={cn('mt-3 text-sm', d('text-white/50', 'text-black/70'))}>
              {isTR ? 'Profilinizi seçin, size özel faydaları görün.' : 'Choose your profile and see the benefits tailored to you.'}
            </p>
          </div>

          {/* Persona buttons */}
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {PERSONAS.map(p => (
              <button
                key={p.key}
                onClick={() => setSelectedPersona(prev => prev === p.key ? null : p.key)}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold border transition-all duration-200',
                  selectedPersona === p.key
                    ? 'bg-brand border-brand text-white shadow-lg shadow-brand/25 scale-105'
                    : d('bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08] hover:border-white/20', 'bg-white border-black/10 text-black/60 hover:border-brand/30 hover:text-brand shadow-sm'),
                )}
              >
                <span>{p.icon}</span>
                <span>{isTR ? p.labelTR : p.labelEN}</span>
              </button>
            ))}
          </div>

          {/* Value prop bullets */}
          <AnimatePresence mode="wait">
            {active && (
              <motion.div
                key={active.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28 }}
                className={cn('rounded-3xl border p-8 max-w-2xl mx-auto', d('bg-white/[0.04] border-white/10', 'bg-white border-black/8 shadow-md'))}
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-3xl">{active.icon}</span>
                  <h3 className={cn('text-lg font-black', d('text-white', 'text-[#111]'))}>
                    {isTR ? active.labelTR : active.labelEN}
                  </h3>
                </div>
                <ul className="space-y-4">
                  {(isTR ? active.bulletsTR : active.bulletsEN).map((b, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-brand/15 flex items-center justify-center">
                        <Check className="w-3 h-3 text-brand" />
                      </span>
                      <span className={cn('text-sm leading-relaxed', d('text-white/70', 'text-black/65'))}>{b}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
            {!active && (
              <motion.p
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={cn('text-center text-sm', d('text-white/60', 'text-black/65'))}
              >
                {isTR ? '↑ Profilinizi seçmek için bir düğmeye tıklayın' : '↑ Click a button above to choose your profile'}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}

// ── Competitor Comparison Table ───────────────────────────────────────────────

const COMP_ROWS = [
  { featureTR: 'Bulut Tabanlı',               featureEN: 'Cloud-Native',              cetpa: 'check', logo: 'x',       mikro: 'x'       },
  { featureTR: 'Mobil PWA',                   featureEN: 'Mobile PWA',                cetpa: 'check', logo: 'partial', mikro: 'x'       },
  { featureTR: 'AI Asistan',                  featureEN: 'AI Assistant',              cetpa: 'check', logo: 'x',       mikro: 'x'       },
  { featureTR: 'Shopify Entegrasyonu',        featureEN: 'Shopify Integration',       cetpa: 'check', logo: 'x',       mikro: 'x'       },
  { featureTR: 'Açık API',                    featureEN: 'Open API',                  cetpa: 'check', logo: 'x',       mikro: 'partial' },
  { featureTR: '14 Gün Ücretsiz Deneme',      featureEN: '14-Day Free Trial',         cetpa: 'check', logo: 'x',       mikro: 'x'       },
  { featureTR: 'Gerçek Zamanlı Dashboard',    featureEN: 'Real-Time Dashboard',       cetpa: 'check', logo: 'partial', mikro: 'x'       },
  { featureTR: 'Kurulum Gerektirmez',         featureEN: 'No Installation Required',  cetpa: 'check', logo: 'x',       mikro: 'x'       },
];

function CellIcon({ val, isTR }: { val: string; isTR: boolean }) {
  // sr-only metinler: ikonlar aria'sizdi, ekran okuyucu karsilastirma
  // tablosunda HICBIR sey duymuyordu (a11y teshisi 2026-08-28).
  if (val === 'check') return <><Check aria-hidden="true" className="w-4 h-4 text-emerald-500 mx-auto" /><span className="sr-only">{isTR ? 'Var' : 'Yes'}</span></>;
  if (val === 'x')     return <><X aria-hidden="true" className="w-4 h-4 text-black/60 mx-auto dark:text-white/55" /><span className="sr-only">{isTR ? 'Yok' : 'No'}</span></>;
  return (
    <span className="flex flex-col items-center gap-0.5">
      <Minus aria-hidden="true" className="w-4 h-4 text-amber-600 dark:text-amber-500 mx-auto" />
      {/* amber-500 beyaz zeminde ~2.15:1 idi (9px metin, AA=4.5:1); amber-700 ~4.9:1 */}
      <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-500">{isTR ? 'Kısmi' : 'Partial'}</span>
    </span>
  );
}

function CompetitorSection({ isTR, d }: SectionProps) {
  return (
    <section className="py-24">
      <div className="w-full max-w-5xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">
              {isTR ? 'Karşılaştırma' : 'Comparison'}
            </p>
            <h2 className={cn('text-3xl md:text-4xl font-black tracking-tight', d('text-white', 'text-[#111]'))}>
              {isTR ? 'Neden CETPA?' : 'Why CETPA?'}
            </h2>
            <p className={cn('mt-3 text-sm', d('text-white/50', 'text-black/70'))}>
              {isTR ? 'Rakiplerimizle yan yana karşılaştırın.' : 'Compare us side by side with alternatives.'}
            </p>
          </div>

          <div className={cn('rounded-3xl border overflow-hidden', d('border-white/10', 'border-black/8 shadow-md'))}>
            {/* Header */}
            <div className={cn('grid grid-cols-4 text-center text-xs font-black uppercase tracking-wider', d('bg-white/[0.04]', 'bg-black/[0.03]'))}>
              <div className={cn('px-4 py-4 text-left', d('text-white/65', 'text-black/70'))}>
                {isTR ? 'Özellik' : 'Feature'}
              </div>
              <div className="px-4 py-4 text-brand">CETPA</div>
              <div className={cn('px-4 py-4', d('text-white/65', 'text-black/70'))}>Logo ERP</div>
              <div className={cn('px-4 py-4', d('text-white/65', 'text-black/70'))}>Mikro</div>
            </div>

            {/* Rows */}
            {COMP_ROWS.map((row, i) => (
              <div
                key={i}
                className={cn(
                  'grid grid-cols-4 text-center text-sm border-t transition-colors',
                  d('border-white/[0.06] hover:bg-white/[0.025]', 'border-black/[0.06] hover:bg-black/[0.02]'),
                )}
              >
                <div className={cn('px-4 py-4 text-left text-xs font-semibold', d('text-white/70', 'text-black/70'))}>
                  {isTR ? row.featureTR : row.featureEN}
                </div>
                <div className={cn('px-4 py-4', d('bg-brand/[0.07]', 'bg-brand/[0.04]'))}>
                  <CellIcon val={row.cetpa} isTR={isTR} />
                </div>
                <div className="px-4 py-4">
                  <CellIcon val={row.logo} isTR={isTR} />
                </div>
                <div className="px-4 py-4">
                  <CellIcon val={row.mikro} isTR={isTR} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── ROI Calculator ────────────────────────────────────────────────────────────

function RoiSection({ isTR, d, darkMode, onTryClick }: SectionProps & { onTryClick: () => void }) {
  const [employees,   setEmployees]   = useState(15);
  const [orderVolume, setOrderVolume] = useState(300);
  const [manualHours, setManualHours] = useState(20);

  // Varsayım: otomasyonla %68 verimlilik (atıf 2026-08-28'de kaldırıldı — kaynak doğrulanamadı)
  const savedHours       = Math.round(manualHours * 4 * 0.68);
  // Varsayım: çalışan başına aylık %12 getiri
  const productivityGain = employees * 1800 * 0.12;
  const roiRatio         = ((productivityGain - 2499) / 2499 * 100).toFixed(0);
  const paybackMonths    = (2499 / (productivityGain / 12)).toFixed(1);

  const sliderClass = cn(
    'w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand',
    d('bg-white/10', 'bg-black/10'),
  );

  return (
    <section className={cn('py-24', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
      <div className="w-full max-w-5xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">ROI</p>
            <h2 className={cn('text-3xl md:text-4xl font-black tracking-tight', d('text-white', 'text-[#111]'))}>
              {isTR ? 'Yatırım getirinizi hesaplayın' : 'Calculate your ROI'}
            </h2>
            <p className={cn('mt-3 text-sm', d('text-white/50', 'text-black/70'))}>
              {isTR ? 'Kaydırıcıları ayarlayın, tasarrufu gerçek zamanlı görün.' : 'Adjust the sliders and see your savings in real time.'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 items-start">
            {/* Inputs */}
            <div className={cn('rounded-3xl border p-8 space-y-8', d('bg-white/[0.04] border-white/10', 'bg-white border-black/8 shadow-md'))}>
              {[
                {
                  labelTR: 'Çalışan sayısı',
                  labelEN: 'Number of employees',
                  value:   employees,
                  setter:  setEmployees,
                  min:     1, max: 200, step: 1,
                  display: String(employees),
                },
                {
                  labelTR: 'Aylık sipariş hacmi',
                  labelEN: 'Monthly order volume',
                  value:   orderVolume,
                  setter:  setOrderVolume,
                  min:     50, max: 5000, step: 50,
                  display: orderVolume.toLocaleString(),
                },
                {
                  labelTR: 'Mevcut manuel süre (saat/hafta)',
                  labelEN: 'Current manual hours/week',
                  value:   manualHours,
                  setter:  setManualHours,
                  min:     1, max: 40, step: 1,
                  display: `${manualHours}h`,
                },
              ].map(({ labelTR, labelEN, value, setter, min, max, step, display }) => (
                <div key={labelEN}>
                  <div className="flex justify-between items-center mb-2">
                    <label className={cn('text-xs font-semibold', d('text-white/70', 'text-black/65'))}>
                      {isTR ? labelTR : labelEN}
                    </label>
                    <span className="text-xs font-black text-brand tabular-nums">{display}</span>
                  </div>
                  <input
                    type="range"
                    min={min} max={max} step={step}
                    value={value}
                    onChange={e => setter(Number(e.target.value))}
                    aria-label={isTR ? labelTR : labelEN}
                    aria-valuetext={display}
                    className={sliderClass}
                  />
                  <div className={cn('flex justify-between text-[10px] mt-1', d('text-white/55', 'text-black/60'))}>
                    <span>{min}</span><span>{max}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Outputs */}
            <div className="space-y-4">
              {[
                {
                  labelTR: 'Tasarruf edilen saat/ay',
                  labelEN: 'Hours saved / month',
                  value:   `${savedHours} ${isTR ? 'saat' : 'hours'}`,
                  accent:  false,
                  citationTR: 'Varsayım: otomasyonla %68 verimlilik',
                  citationEN: 'Assumption: 68% efficiency from automation',
                },
                {
                  labelTR: 'Verimlilik artışı',
                  labelEN: 'Productivity gain',
                  value:   `₺${productivityGain.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} / ${isTR ? 'ay' : 'mo'}`,
                  accent:  false,
                  citationTR: 'Varsayım: çalışan başına aylık %12 getiri',
                  citationEN: 'Assumption: 12% ROI per employee per month',
                },
                {
                  labelTR: 'ROI oranı',
                  labelEN: 'ROI ratio',
                  value:   `${Number(roiRatio) > 0 ? '+' : ''}${roiRatio}%`,
                  accent:  true,
                  citationTR: null,
                  citationEN: null,
                },
                {
                  labelTR: 'Geri ödeme süresi',
                  labelEN: 'Payback period',
                  value:   `${paybackMonths} ${isTR ? 'ay' : 'months'}`,
                  accent:  false,
                  citationTR: null,
                  citationEN: null,
                },
              ].map(({ labelTR, labelEN, value, accent, citationTR, citationEN }) => (
                <motion.div
                  key={labelEN}
                  layout
                  className={cn(
                    'rounded-2xl border px-6 py-5',
                    accent
                      ? 'bg-brand/10 border-brand/25'
                      : d('bg-white/[0.04] border-white/10', 'bg-white border-black/8 shadow-sm'),
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs font-semibold', d('text-white/60', 'text-black/55'))}>
                      {isTR ? labelTR : labelEN}
                    </span>
                    <span className={cn('text-lg font-black tabular-nums', accent ? 'text-brand' : d('text-white', 'text-[#111]'))}>
                      {value}
                    </span>
                  </div>
                  {(citationTR || citationEN) && (
                    <p className={cn('text-[10px] mt-1.5', d('text-white/55', 'text-black/65'))}>
                      {isTR ? citationTR : citationEN}
                    </p>
                  )}
                </motion.div>
              ))}

              <p className={cn('text-[10px] text-center mt-2', d('text-white/55', 'text-black/60'))}>
                {isTR
                  ? '* Bu hesaplayıcı sektör genelinde yaygın varsayımlara dayalı bir TAHMİNDİR; sonuçlar işletmeye göre değişir.'
                  : '* This calculator is an ESTIMATE based on common industry assumptions; results vary by business.'}
              </p>

              {/* UYDURMA referans alıntısı KALDIRILDI (2026-08-28): "Emre K.,
                  Tekstil A.Ş. CEO, %71" — gerçek olmayan kişi, şirket ve rakam.
                  Sahte müşteri değerlendirmesi sınıfı; gerçek bir alıntı
                  gelirse buraya kaynağıyla konur. */}

              <button
                onClick={onTryClick}
                className="w-full mt-2 flex items-center justify-center gap-2 bg-brand hover:bg-brand/90 text-white font-bold text-sm px-6 py-4 rounded-2xl transition-all duration-200 shadow-lg shadow-brand/25 hover:scale-[1.02] active:scale-[0.98]"
              >
                {isTR ? '14 Gün Ücretsiz Dene' : 'Start 14-Day Free Trial'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

function FAQItem({ q, a, darkMode }: { q: string; a: string; darkMode: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={cn('border rounded-2xl overflow-hidden transition-colors', darkMode ? 'border-white/8' : 'border-black/8')}>
      <button
        className={cn('w-full flex items-center justify-between px-6 py-5 text-left font-semibold text-sm gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset', darkMode ? 'hover:bg-white/4' : 'hover:bg-black/3')}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {q}
        <ChevronDown className={cn('w-4 h-4 flex-shrink-0 transition-transform duration-300', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div id={panelId} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
            <p className={cn('px-6 pb-6 text-sm leading-relaxed', darkMode ? 'text-white/50' : 'text-black/70')}>{a}</p>
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
          <p className={cn('text-xs', darkMode ? 'text-white/65' : 'text-black/70')}>{role} · {company}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ── Innovation Orb (SAP-style circular animation) ─────────────────────────────

function InnovationOrb({ isTR, darkMode, activeIdx }: {
  isTR: boolean; darkMode: boolean; activeIdx: number;
}) {
  const W = 320; const cx = W / 2; const cy = W / 2;
  const RO = 126; const RI = 92; const RM = (RO + RI) / 2; const RW = RO - RI;

  const toXY = (deg: number, r: number): [number, number] => {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const arcPath = (r: number, a0: number, a1: number) => {
    const [sx, sy] = toXY(a0, r);
    const [ex, ey] = toXY(a1, r);
    const span = ((a1 - a0) + 360) % 360;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  };

  // 3 segments × 110° each, 10° gaps. Centers at: AI=270 (top), ERP=30 (br), DATA=150 (bl)
  const segs = [
    { label: isTR ? 'AI'    : 'AI',   sub: isTR ? 'Yapay Zeka' : 'Intelligence', color: '#7c3aed', a0: 215, a1: 325, center: 270 },
    { label: isTR ? 'ERP'   : 'ERP',  sub: isTR ? 'Bulut ERP'  : 'Cloud ERP',   color: '#ff4000', a0: 335, a1: 85,  center: 30  },
    { label: isTR ? 'VERİ'  : 'DATA', sub: isTR ? 'Veri'       : 'Data',        color: '#0ea5e9', a0: 95,  a1: 205, center: 150 },
  ];

  const centerLines = isTR ? [
    ['ERP platformu', 'zekayı eyleme', 'dönüştürür'],
    ['Uygulamalar', 'süreçleri', 'otomatikleştirir'],
    ['Güvenilir veri', 'her kararın', 'temelinde'],
  ] : [
    ['ERP platform', 'turns intelligence', 'into action'],
    ['Applications', 'automate every', 'process'],
    ['Reliable data', 'powers every', 'decision'],
  ];

  return (
    <div className="relative" style={{ width: W, height: W }}>
      <svg width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
        {/* Dashed orbit rings */}
        {[RO + 20, RO + 40].map((r, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
            strokeWidth="1" strokeDasharray="4 8" />
        ))}
        <circle cx={cx} cy={cy} r={RI - 20} fill="none"
          stroke={darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
          strokeWidth="1" strokeDasharray="4 8" />

        {/* Gray arc tracks */}
        {segs.map((s, i) => (
          <path key={`t${i}`} d={arcPath(RM, s.a0, s.a1)} fill="none"
            stroke={darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}
            strokeWidth={RW} strokeLinecap="round" />
        ))}

        {/* Colored arcs — opacity transition on active */}
        {segs.map((s, i) => (
          <path key={`a${i}`} d={arcPath(RM, s.a0, s.a1)} fill="none"
            stroke={s.color} strokeWidth={RW} strokeLinecap="round"
            opacity={activeIdx === i ? 1 : 0.2}
            style={{ transition: 'opacity 0.7s ease' }} />
        ))}

        {/* Glow halo + dot on each arc's midpoint */}
        {segs.map((s, i) => {
          const [x, y] = toXY(s.center, RM);
          const active = activeIdx === i;
          return (
            <g key={`d${i}`}>
              <circle cx={x} cy={y} r={15} fill={s.color}
                opacity={active ? 0.18 : 0} style={{ transition: 'opacity 0.5s' }} />
              <circle cx={x} cy={y} r={active ? 7.5 : 5} fill="white"
                opacity={active ? 1 : 0.35} style={{ transition: 'all 0.5s ease' }} />
            </g>
          );
        })}

        {/* Labels positioned at outer edge of each segment */}
        {segs.map((s, i) => {
          const [lx, ly] = toXY(s.center, RO + 34);
          return (
            <g key={`l${i}`} opacity={activeIdx === i ? 1 : 0.35}
              style={{ transition: 'opacity 0.5s' }}>
              <text x={lx} y={ly - 5} textAnchor="middle" fill={s.color}
                fontSize="12.5" fontWeight="800" fontFamily="system-ui,sans-serif">{s.label}</text>
              <text x={lx} y={ly + 9} textAnchor="middle"
                fill={darkMode ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)'}
                fontSize="10" fontFamily="system-ui,sans-serif">{s.sub}</text>
            </g>
          );
        })}

        {/* Center circle */}
        <circle cx={cx} cy={cy} r={RI - 8}
          fill={darkMode ? '#0a0a12' : 'white'}
          stroke={darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} strokeWidth="1" />
      </svg>

      {/* Animated center text */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{ width: (RI - 8) * 2 - 20 }} className="text-center px-2">
          <AnimatePresence mode="wait">
            <motion.div key={activeIdx}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
              className={cn('text-[11px] font-semibold leading-snug', darkMode ? 'text-white/80' : 'text-gray-600')}>
              {centerLines[activeIdx].map((line, j) => <span key={j} className="block">{line}</span>)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── Innovation Section (SAP-style "Innovation never stops") ───────────────────

function InnovationSection({ isTR, darkMode, d, onTryClick, isLoggedIn, onDashboardClick }: {
  isTR: boolean; darkMode: boolean; d: (dk: string, lt: string) => string;
  onTryClick: () => void; isLoggedIn: boolean; onDashboardClick?: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (paused) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => setActiveIdx(i => (i + 1) % 3), 4000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [paused]);

  const items = [
    {
      icon: Activity,
      title: 'CETPA Business AI',
      desc: isTR
        ? 'Gömülü yapay zeka, satış tahminlerini otomatikleştirir ve her süreçte eyleme dönüşür.'
        : 'Embedded AI automates sales forecasts and turns insights into action across every process.',
    },
    {
      icon: LayoutDashboard,
      title: isTR ? 'CETPA Cloud ERP' : 'CETPA Cloud ERP',
      desc: isTR
        ? 'Bulut ERP uygulamaları, tüm iş süreçlerinizi tek platformda düzenler ve işletmenizin çalışma şeklini geliştirmek için yapay zeka analizlerini etkinleştirir.'
        : 'Cloud ERP applications organize all your business processes on a single platform and enable AI analytics to improve how your business operates.',
    },
    {
      icon: Database,
      title: isTR ? 'CETPA Data Cloud' : 'CETPA Data Cloud',
      desc: isTR
        ? 'Güvenilir, bağlamsal veriler yapay zekaya ve uygulamalara ortak yön vererek veri odaklı kararlar almanızı sağlar.'
        : 'Reliable, contextual data guides both AI and applications on a unified path, enabling data-driven decisions.',
    },
  ];

  const rightDesc = isTR
    ? 'Yapay zekayı, verileri ve uygulamaları CETPA Business Suite ile bir araya getirerek her kararın bir sonraki karar için bilgi sağladığı, içgörüyü eyleme ve eylemi sürekli yeniliğe dönüştüren bir sistem oluşturun.'
    : 'Bring together AI, data and applications with CETPA Business Suite to create a system where every decision informs the next, turning insight into action and action into continuous innovation.';

  return (
    <section className={cn('py-24 relative overflow-hidden', d('bg-white/[0.02]', 'bg-slate-50/70'))}>
      {/* Subtle ambient */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: d(
          'radial-gradient(ellipse at 15% 55%, rgba(124,58,237,0.06) 0%, transparent 55%)',
          'radial-gradient(ellipse at 15% 55%, rgba(124,58,237,0.04) 0%, transparent 55%)'
        )}} />

      <div className="w-full max-w-6xl mx-auto px-6 relative z-10">
        {/* Eyebrow + title */}
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <p className="text-xs font-bold tracking-widest text-brand mb-3">
            CETPA BUSINESS SUITE
          </p>
          <h2 className={cn('text-3xl md:text-4xl font-black mb-16 leading-tight', d('text-white', 'text-gray-900'))}>
            {isTR ? 'İnovasyon asla durmaz' : 'Innovation never stops'}
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* ── Left: Animated orb ── */}
          <motion.div className="flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <InnovationOrb isTR={isTR} darkMode={darkMode} activeIdx={activeIdx} />
            {/* Pause/Play toggle */}
            <button
              onClick={() => setPaused(p => !p)}
              className={cn(
                'mt-3 w-11 h-11 md:w-8 md:h-8 rounded-full border flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                d('border-white/15 text-white/60 hover:text-white/65 hover:bg-white/6',
                  'border-black/12 text-black/65 hover:text-black/55 hover:bg-black/5')
              )}
              title={paused ? (isTR ? 'Oynat' : 'Play') : (isTR ? 'Duraklat' : 'Pause')}
              aria-label={paused ? (isTR ? 'Oynat' : 'Play') : (isTR ? 'Duraklat' : 'Pause')}
              aria-pressed={!paused}
            >
              {paused
                ? <Play className="w-3 h-3" aria-hidden="true" />
                : <Pause className="w-3 h-3" aria-hidden="true" />}
            </button>
          </motion.div>

          {/* ── Right: Content ── */}
          <motion.div initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}>
            <h3 className={cn('text-2xl font-black mb-4 leading-tight', d('text-white', 'text-gray-900'))}>
              {isTR ? 'Bağlantıyı momentuma dönüştürün' : 'Turn connectivity into momentum'}
            </h3>
            <p className={cn('text-sm leading-relaxed mb-8', d('text-white/50', 'text-black/70'))}>
              {rightDesc}
            </p>

            {/* Clickable feature rows */}
            <div className="space-y-2">
              {items.map((item, i) => {
                const Icon = item.icon;
                const isActive = activeIdx === i;
                return (
                  <button key={i} className="w-full text-left"
                    onClick={() => { setActiveIdx(i); setPaused(true); }}>
                    <div className={cn(
                      'flex gap-4 p-4 rounded-2xl transition-all duration-300 group border',
                      isActive
                        ? d('bg-white/6 border-white/10', 'bg-white border-black/8 shadow-md')
                        : d('border-transparent hover:bg-white/4', 'border-transparent hover:bg-white hover:border-black/6 hover:shadow-sm')
                    )}>
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
                        isActive ? 'bg-brand/15' : 'bg-brand/8 group-hover:bg-brand/12'
                      )}>
                        <Icon className="w-[18px] h-[18px] text-brand" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn('font-bold text-[13px] transition-colors',
                            isActive ? 'text-brand' : d('text-white/80', 'text-gray-800'))}>
                            {item.title}
                          </span>
                          <ArrowRight className={cn('w-3.5 h-3.5 transition-all',
                            isActive ? 'text-brand translate-x-0.5' : d('text-white/55', 'text-black/60'))} />
                        </div>
                        <p className={cn('text-xs leading-relaxed', d('text-white/65', 'text-black/70'))}>
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={isLoggedIn ? onDashboardClick : onTryClick}
              className="mt-8 bg-brand text-white px-6 py-3 rounded-full text-sm font-bold hover:bg-orange-500 transition-all shadow-md shadow-brand/25 flex items-center gap-2 active:scale-95">
              {isTR ? "CETPA Business Suite'i keşfedin" : 'Explore CETPA Business Suite'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ── Spotlight Section (enterprise split-layout feature block) ─────────────────

function SpotlightSection({ isTR, darkMode, d, eyebrow, title, desc, bullets, ctaLabel, onCta, reverse = false, icon: Icon, accent, stat1, stat2 }: {
  isTR: boolean; darkMode: boolean; d: (dk: string, lt: string) => string;
  eyebrow: string; title: string; desc: string; bullets: string[];
  ctaLabel: string; onCta: () => void;
  reverse?: boolean;
  icon: React.ElementType; accent: string;
  stat1?: { value: string; label: string };
  stat2?: { value: string; label: string };
}) {
  const visual = (
    <motion.div
      initial={{ opacity: 0, x: reverse ? -30 : 30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative rounded-3xl p-8 flex flex-col items-center justify-center gap-6 min-h-[320px]',
        d('bg-white/4 border border-white/8', 'bg-white border border-black/8 shadow-xl')
      )}
      style={{
        background: d(
          `radial-gradient(circle at 30% 30%, ${accent}12 0%, transparent 65%)`,
          `radial-gradient(circle at 30% 30%, ${accent}07 0%, transparent 65%)`
        )
      }}
    >
      {/* Corner accent blob */}
      <div className="absolute top-0 right-0 w-48 h-48 rounded-br-3xl overflow-hidden pointer-events-none opacity-30"
        style={{ background: `radial-gradient(circle at 100% 0%, ${accent}30 0%, transparent 70%)` }} />

      {/* Icon */}
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center relative z-10"
        style={{ backgroundColor: `${accent}15`, boxShadow: `0 0 0 8px ${accent}08` }}>
        <Icon className="w-10 h-10" style={{ color: accent }} />
      </div>

      {/* Bullet pills */}
      <div className="w-full space-y-2.5 relative z-10">
        {bullets.slice(0, 4).map((b, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ delay: i * 0.07 }}
            className={cn('flex items-center gap-3 px-4 py-2.5 rounded-xl', d('bg-white/6', 'bg-gray-50'))}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${accent}20` }}>
              <Check className="w-2.5 h-2.5" style={{ color: accent }} />
            </div>
            <span className={cn('text-xs font-medium', d('text-white/75', 'text-gray-700'))}>{b}</span>
          </motion.div>
        ))}
      </div>

      {/* Mini stats */}
      {(stat1 || stat2) && (
        <div className="flex gap-4 w-full relative z-10">
          {[stat1, stat2].filter(Boolean).map((s, i) => s && (
            <div key={i} className={cn('flex-1 text-center px-3 py-3 rounded-2xl', d('bg-white/5', 'bg-gray-50'))}>
              <p className="text-2xl font-black" style={{ color: accent }}>{s.value}</p>
              <p className={cn('text-[10px] font-medium mt-0.5', d('text-white/65', 'text-black/70'))}>{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );

  const content = (
    <motion.div
      initial={{ opacity: 0, x: reverse ? 30 : -30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}>
      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: accent }}>{eyebrow}</p>
      <h2 className={cn('text-3xl md:text-4xl font-black mb-5 leading-tight', d('text-white', 'text-gray-900'))}>
        {title}
      </h2>
      <p className={cn('text-sm leading-relaxed mb-8', d('text-white/50', 'text-black/70'))}>{desc}</p>
      <ul className="space-y-3.5 mb-10">
        {bullets.map((b, i) => (
          <li key={i} className={cn('flex items-start gap-3 text-sm', d('text-white/70', 'text-gray-700'))}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: `${accent}15` }}>
              <Check className="w-2.5 h-2.5" style={{ color: accent }} />
            </div>
            {b}
          </li>
        ))}
      </ul>
      <button onClick={onCta}
        className="inline-flex items-center gap-2 font-bold text-sm transition-all hover:gap-3"
        style={{ color: accent }}>
        {ctaLabel}
        <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );

  return (
    <section className="py-20">
      <div className="w-full max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          {reverse ? <>{content}{visual}</> : <>{visual}{content}</>}
        </div>
      </div>
    </section>
  );
}

// ── Accountant Partner Program Section ────────────────────────────────────────

function AccountantPartnerSection({ isTR, d }: SectionProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [hata, setHata] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setHata(false);
    try {
      await addDoc(collection(db, 'partnerApplications'), {
        email: email.trim(),
        type: 'cpa_partner',
        createdAt: serverTimestamp(),
        status: 'new',
        source: 'landing_partner_section',
      });
      // "Alındı" YALNIZ gerçekten yazılınca denir. Eski kod catch'i yutup
      // koşulsuz success gösteriyordu — yazma düşerse başvuru KAYBOLUYOR ve
      // başvuran bunu asla öğrenemiyordu (a11y teşhisi 2026-08-28).
      setSubmitted(true);
    } catch {
      setHata(true);
    }
  };

  const benefits = [
    {
      emoji: '🆓',
      titleTR: 'Ücretsiz CPA Lisansı',
      titleEN: 'Free CPA License',
      descTR: 'Tüm modüllere sınırsız erişim, ücret yok.',
      descEN: 'Unlimited access to all modules. Zero cost.',
    },
    {
      emoji: '💸',
      titleTR: 'Gelir Paylaşımı',
      titleEN: 'Revenue Share',
      descTR: 'Her yönlendirdiğiniz aktif abonelikten %20 aylık komisyon.',
      descEN: '20% monthly commission on every active subscription you refer.',
    },
    {
      emoji: '🏆',
      // İSMMMO referansı KALDIRILDI (2026-08-28): gerçek bir kuruma
      // (İstanbul SMMM Odası) doğrulanamayan bir 'uyumluluk/sertifika'
      // bağlantısı iddia ediliyordu. Rozet programı gerçekse kurumun adı
      // ancak yazılı izinle geri konur.
      titleTR: 'Sertifika & Rozet',
      titleEN: 'Certification & Badge',
      descTR: 'CETPA Ortak rozetini web sitenize ekleyin.',
      descEN: 'Add the CETPA Partner badge to your site.',
    },
  ];

  return (
    <section id="partners" className={cn('py-24', d('bg-white/[0.025]', 'bg-[#fff8f5]'))}>
      <div className="w-full max-w-5xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="text-center mb-12">
            <div className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold tracking-wide mb-6 uppercase', d('bg-white/4 border-white/10 text-white/70', 'bg-brand/8 border-brand/20 text-brand'))}>
              {isTR ? 'Muhasebeci & Mali Müşavir Programı' : 'Accountant & CPA Partner Program'}
            </div>
            <h2 className={cn('text-3xl md:text-4xl font-black tracking-tight mb-4', d('text-white', 'text-[#111]'))}>
              {isTR ? 'Müşterileriniz için siz seçin, siz kazanın.' : 'You recommend. You earn.'}
            </h2>
            <p className={cn('mt-3 text-sm max-w-xl mx-auto', d('text-white/50', 'text-black/70'))}>
              {isTR
                ? 'Mali müşavirler CETPA\'yı ücretsiz kullanır, her müşteri yönlendirmesinden gelir payı alır.'
                : "CPAs use CETPA free. Earn revenue share on every client referral."}
            </p>
          </div>

          {/* Benefit cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {benefits.map((b, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={cn('p-7 rounded-3xl border text-center', d('bg-white/[0.04] border-white/10', 'bg-white border-black/8 shadow-sm'))}
              >
                <div className="text-4xl mb-4">{b.emoji}</div>
                <h3 className={cn('font-black text-sm mb-2', d('text-white', 'text-[#111]'))}>
                  {isTR ? b.titleTR : b.titleEN}
                </h3>
                <p className={cn('text-xs leading-relaxed', d('text-white/50', 'text-black/70'))}>
                  {isTR ? b.descTR : b.descEN}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Application form */}
          <div className={cn('max-w-lg mx-auto rounded-3xl border p-8', d('bg-white/[0.04] border-white/10', 'bg-white border-black/8 shadow-md'))}>
            <p className={cn('text-xs font-bold uppercase tracking-widest text-center mb-5', d('text-white/50', 'text-black/70'))}>
              {isTR ? 'Mali müşavir ortaklık programına başvurun' : 'Apply for the CPA partner program'}
            </p>
            {hata && (
              <p className="text-xs rounded-xl px-3 py-2 mb-3 border bg-red-50 border-red-100 text-red-600">
                {isTR
                  ? 'Kaydedemedik — lütfen info@cetpa.com.tr adresine yazın.'
                  : 'Could not save — please email info@cetpa.com.tr.'}
              </p>
            )}
            {!submitted ? (
              <form onSubmit={handleSubmit} action={`mailto:info@cetpa.com.tr`} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={isTR ? 'iş e-posta adresiniz' : 'your business email'}
                  aria-label={isTR ? 'İş e-posta adresiniz' : 'Your business email'}
                  className={cn('flex-1 px-4 py-3 rounded-xl text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', d('bg-white/8 border border-white/10 text-white placeholder:text-white/60 focus:border-brand/40', 'bg-[#f5f5f7] border border-transparent text-[#111] placeholder:text-black/65 focus:border-brand/30'))}
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-brand text-white font-bold text-sm hover:bg-orange-500 transition-all shadow-md shadow-brand/25 active:scale-95 whitespace-nowrap"
                >
                  {isTR ? 'Başvur' : 'Apply'}
                </button>
              </form>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn('text-center py-4 px-6 rounded-xl', d('bg-emerald-500/10 text-emerald-400', 'bg-emerald-50 text-emerald-700'))}
              >
                <p className="text-sm font-semibold">
                  {isTR
                    ? 'Başvurunuz alındı! info@cetpa.com.tr adresinden size ulaşacağız.'
                    : "Application received! We'll reach out via info@cetpa.com.tr."}
                </p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function LandingPage({
  currentLanguage, onLoginClick, onTryClick, onDashboardClick,
  heroImageUrl, isLoggedIn, onLanguageToggle, darkMode, onDarkModeToggle,
}: LandingPageProps) {
  const isTR = currentLanguage === 'tr';
  const [scrolled, setScrolled] = useState(false);
  const [pricingAnnual, setPricingAnnual] = useState(true);
  const d = (dk: string, lt: string) => darkMode ? dk : lt;

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  // ─── Firestore-backed testimonials (with static fallback) ────────────────────
  /**
   * Statik yedek KALDIRILDI (2026-08-28). Burada üç UYDURMA müşteri referansı
   * vardı: gerçek olmayan isimler ("Ahmet Y.", "Selin K."), gerçek olmayan
   * şirketler ("YapıTrade A.Ş.", "KozmoTex"), uydurma rakamlar (%60, %35,
   * "3 gün yerine 3 saat") ve 5 yıldız. Sahte müşteri değerlendirmesi
   * yayınlamak Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği'ne
   * aykırıdır; gerçek referans gelene dek bölüm HİÇ gösterilmez —
   * `testimonials` koleksiyonuna gerçek kayıt girildiğinde kendiliğinden açılır.
   */
  const staticTestimonials: Array<{ quote: string; name: string; role: string; company: string; rating: number }> = [];
  const [firestoreTestimonials, setFirestoreTestimonials] = useState<typeof staticTestimonials | null>(null);
  const testimonials = firestoreTestimonials ?? staticTestimonials;

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'testimonials')), snap => {
      if (!snap.empty) {
        setFirestoreTestimonials(snap.docs
          .sort(byField('order', 'asc'))
          .map(d => {
            const x = d.data();
            return {
              quote: isTR ? (x.quote_tr ?? x.quote ?? '') : (x.quote_en ?? x.quote ?? ''),
              name: x.name ?? '',
              role: isTR ? (x.role_tr ?? x.role ?? '') : (x.role_en ?? x.role ?? ''),
              company: x.company ?? '',
              rating: x.rating ?? 5,
            };
          }));
      } else {
        setFirestoreTestimonials(null); // fall back to static
      }
    }, () => setFirestoreTestimonials(null));
    return unsub;
  }, [isTR]);

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

  const faqs = [
    { q: isTR ? 'Kurulum ne kadar sürer?' : 'How long does setup take?', a: isTR ? 'Temel kurulum 1 iş günü içinde tamamlanır. Shopify ve muhasebe entegrasyonlarıyla birlikte tam onboarding ortalama 3-5 gün sürmektedir.' : 'Basic setup is complete within 1 business day. Full onboarding with Shopify and accounting integrations averages 3-5 days.' },
    { q: isTR ? 'Mevcut verilerim korunur mu?' : 'Is my existing data protected?', a: isTR ? 'Evet. CSV ve API yoluyla mevcut ERP, Excel veya muhasebe yazılımlarından tüm verilerinizi içe aktarıyoruz. Veri kaybı yaşanmaz.' : 'Yes. We import all your data from existing ERP, Excel or accounting software via CSV and API. No data loss.' },
    { q: isTR ? 'Hangi entegrasyonlar destekleniyor?' : 'Which integrations are supported?', a: isTR ? 'Shopify, Mikro ERP, Luca Muhasebe, iyzico, Google Maps, 360Dialog WhatsApp ve tüm Türk kargo şirketleri desteklenmektedir.' : 'Shopify, Mikro ERP, Luca Accounting, iyzico, Google Maps, 360Dialog WhatsApp and all Turkish cargo companies are supported.' },
    { q: isTR ? 'Fiyatlandırma esnek midir?' : 'Is pricing flexible?', a: isTR ? 'Evet. Kullanıcı sayısına ve modüle göre özelleştirilmiş teklifler sunuyoruz. Yıllık ödemelerde %20 indirim uygulanır.' : 'Yes. We offer customized quotes based on user count and module selection. Annual payments receive 20% off.' },
    { q: isTR ? 'Teknik destek nasıl çalışır?' : 'How does technical support work?', a: isTR ? 'Enterprise planlarda 7/24 canlı destek ve dedicated hesap yöneticisi sağlanır. Startup planında mesai saatlerinde canlı chat desteği mevcuttur.' : 'Enterprise plans include 24/7 live support and a dedicated account manager. Startup plans include live chat support during business hours.' },
  ];

  const staticPricingPlans = [
    {
      name: 'Startup',
      monthlyTR: 2990, yearlyTR: 2390,
      monthlyEN: 79,   yearlyEN: 63,
      desc: isTR ? 'Büyüyen işletmeler için' : 'For growing businesses',
      features: isTR
        ? ['CRM & Lead Yönetimi', 'Stok & Sipariş Takibi', 'Shopify Entegrasyonu', 'e-Fatura · e-Arşiv · e-İrsaliye', '3 Kullanıcı', 'Mesai İçi Destek']
        : ['CRM & Lead Management', 'Stock & Order Tracking', 'Shopify Integration', 'e-Invoice · e-Archive · e-Waybill', '3 Users', 'Business Hours Support'],
      highlight: false, cta: isTR ? 'Hemen Başla' : 'Start Now',
    },
    {
      name: 'Enterprise',
      monthlyTR: 7490, yearlyTR: 5990,
      monthlyEN: 199,  yearlyEN: 159,
      desc: isTR ? 'Ölçekli operasyonlar için' : 'For scaled operations',
      badge: isTR ? '🔥 En Popüler' : '🔥 Most Popular',
      features: isTR
        ? ['Tüm Modüller Dahil', 'Mikro & Luca Sync', 'Üretim & BOM Planlama', 'İK & Bordro', 'Sınırsız Kullanıcı', '7/24 Öncelikli Destek']
        : ['All Modules Included', 'Mikro & Luca Sync', 'Production & BOM Planning', 'HR & Payroll', 'Unlimited Users', '24/7 Priority Support'],
      highlight: true, cta: isTR ? 'Bize Ulaşın' : 'Contact Us',
    },
    {
      name: 'Custom',
      monthlyTR: null, yearlyTR: null,
      monthlyEN: null, yearlyEN: null,
      desc: isTR ? 'Kurumsal & holdingler için' : 'For enterprise & holdings',
      features: isTR
        ? ['Özel Geliştirme', 'Yerinde Kurulum', 'Özel API Entegrasyonları', 'Dedicated Sunucu', 'VIP Hesap Yöneticisi', 'Sözleşmeyle Belirlenen SLA']
        : ['Custom Development', 'On-premise Setup', 'Custom API Integrations', 'Dedicated Server', 'VIP Account Manager', 'Contract-Defined SLA'],
      highlight: false, cta: isTR ? 'Teklif Al' : 'Get Quote',
    },
  ];
  const [firestorePricing, setFirestorePricing] = useState<typeof staticPricingPlans | null>(null);
  const pricingPlans = firestorePricing ?? staticPricingPlans;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'pricing'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        // `exists()` true olsa da `data()` tipi `undefined` icerir (dbClient shim).
        // Veri gelmediyse mevcut fiyat planlarina DOKUNMA - bos degerle ezme.
        if (!d) return;
        // Firestore doc shape: { startup_monthly_tr, startup_yearly_tr, startup_monthly_en, startup_yearly_en,
        //                         enterprise_monthly_tr, enterprise_yearly_tr, enterprise_monthly_en, enterprise_yearly_en }
        setFirestorePricing(prev => (prev === null ? staticPricingPlans : prev).map((plan, i) => {
          const key = i === 0 ? 'startup' : i === 1 ? 'enterprise' : null;
          if (!key) return plan;
          return {
            ...plan,
            monthlyTR: d[`${key}_monthly_tr`] ?? plan.monthlyTR,
            yearlyTR:  d[`${key}_yearly_tr`]  ?? plan.yearlyTR,
            monthlyEN: d[`${key}_monthly_en`] ?? plan.monthlyEN,
            yearlyEN:  d[`${key}_yearly_en`]  ?? plan.yearlyEN,
          };
        }));
      }
    }, () => {}); // silently ignore errors on public page
    return unsub;
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('min-h-screen font-sans overflow-x-hidden transition-colors duration-500', d('bg-[#05050a] text-[#f5f5f7]', 'bg-[#fafafa] text-[#111]'))}>

      {/* Skip link: hidden until keyboard-focused, lets keyboard users bypass the nav */}
      <a href="#main-content" className="skip-link">
        {isTR ? 'Ana içeriğe geç' : 'Skip to main content'}
      </a>

      {/* CSS keyframes */}
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
        /* WCAG 2.2.2: 5 sn'den uzun otomatik hareket durdurulabilir olmali. */
        .cetpa-marquee-track:hover, .cetpa-marquee-track:focus-within { animation-play-state: paused; }
        /* WCAG 2.3.3 / prefers-reduced-motion: sonsuz animasyonlarin tamami
           kapanir (a11y teshisi 2026-08-28 — hicbir yerde taninmiyordu).
           motion/react giris animasyonlari KISA ve TEK SEFERLIK — reduce
           kapsaminda kritik olan sonsuz hareketti; MotionConfig denendi ama
           reducedMotion="user" TUM whileInView animasyonlarini reduce KAPALI
           iken bile opacity:0'da kilitledi (152 eleman, 2026-08-29 olcumu) —
           regresyon oldugu icin geri alindi. */
        @media (prefers-reduced-motion: reduce) {
          .cetpa-float, .cetpa-marquee-track, .cetpa-gradient-text,
          [class*='cetpa-spin'], [class*='cetpa-pulse'], [class*='cetpa-sparkle'] {
            animation: none !important;
          }
        }
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
      <nav className="fixed top-0 left-0 right-0 z-50">
        <div className={cn(
          'transition-all duration-300',
          scrolled
            ? d('bg-[#08080f]/85 border-b border-white/8 backdrop-blur-2xl shadow-2xl shadow-black/40', 'bg-white/92 border-b border-black/8 backdrop-blur-2xl shadow-lg shadow-black/8')
            : d('bg-[#05050a]/50 border-b border-white/4 backdrop-blur-sm', 'bg-white/70 border-b border-black/5 backdrop-blur-sm')
        )}>
          <div className="max-w-6xl mx-auto flex items-center justify-between h-[60px] px-5 sm:px-8">
            <div className="flex items-center gap-8">
              <img src="/cetpalogo.avif" alt="CETPA" className="h-7 w-auto object-contain flex-shrink-0" />
              <div className="hidden md:flex items-center gap-5">
                {[
                  { id: 'innovation', label: isTR ? 'Ürünler'       : 'Products'    },
                  { id: 'how',        label: isTR ? 'Nasıl Çalışır' : 'How It Works' },
                  { id: 'features',   label: isTR ? 'Özellikler'    : 'Features'    },
                  { id: 'pricing',    label: isTR ? 'Fiyatlar'      : 'Pricing'     },
                  { id: 'solutions',  label: isTR ? 'Sektörler'     : 'Industries'  },
                  { id: 'partners',   label: isTR ? 'Ortaklar'      : 'Partners'    },
                ].map(({ id, label }) => (
                  <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
                    className={cn('text-[13px] font-medium whitespace-nowrap transition-colors shrink-0', d('text-white/55 hover:text-white', 'text-black/55 hover:text-black'))}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-4">
              <button onClick={onLanguageToggle}
                aria-label={isTR ? 'Dili İngilizce yap' : 'Switch to Turkish'}
                className={cn('text-[11px] font-bold min-w-11 min-h-11 md:min-w-0 md:min-h-0 px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', d('border-white/12 text-white/50 hover:text-white hover:bg-white/8', 'border-black/10 text-black/70 hover:text-black hover:bg-black/5'))}>
                {currentLanguage === 'tr' ? 'EN' : 'TR'}
              </button>
              <button onClick={onDarkModeToggle}
                aria-label={darkMode ? (isTR ? 'Açık moda geç' : 'Switch to light mode') : (isTR ? 'Koyu moda geç' : 'Switch to dark mode')}
                aria-pressed={darkMode}
                className={cn('w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', d('border-white/12 text-white/50 hover:text-white hover:bg-white/8', 'border-black/10 text-black/70 hover:text-black hover:bg-black/5'))}>
                {darkMode ? <Sun className="w-[15px] h-[15px]" aria-hidden="true" /> : <Moon className="w-[15px] h-[15px]" aria-hidden="true" />}
              </button>
              {/* Mobil menu (EN SAGDA: solda EN/tema ile cakisiyordu — olculdu: EN 112-149, burger 128-172 ustuste) (a11y teshisi: 6 bolum baglantisi md alti TAMAMEN
                  kayboluyordu, Fiyatlar'a tek yol ~10 ekran scroll'du).
                  Native <details>: JS'siz, ESC/fokus tarayicidan bedava. */}
              <details className="md:hidden relative">
                <summary
                  aria-label={isTR ? 'Menü' : 'Menu'}
                  className={cn('list-none cursor-pointer w-11 h-11 -my-1 flex items-center justify-center rounded-lg border transition-all',
                    d('border-white/15 text-white/70', 'border-black/15 text-black/70'))}
                >
                  <MenuIcon className="w-5 h-5" aria-hidden="true" />
                </summary>
                <div className={cn('absolute right-0 top-12 z-50 min-w-44 rounded-2xl border shadow-xl py-2',
                  d('bg-[#0c0c12] border-white/10', 'bg-white border-black/10'))}>
                  {[
                    { id: 'innovation', label: isTR ? 'Ürünler'       : 'Products'    },
                    { id: 'how',        label: isTR ? 'Nasıl Çalışır' : 'How It Works' },
                    { id: 'features',   label: isTR ? 'Özellikler'    : 'Features'    },
                    { id: 'pricing',    label: isTR ? 'Fiyatlar'      : 'Pricing'     },
                    { id: 'solutions',  label: isTR ? 'Sektörler'     : 'Industries'  },
                    { id: 'partners',   label: isTR ? 'Ortaklar'      : 'Partners'    },
                  ].map(({ id, label }) => (
                    <button key={id}
                      onClick={e => {
                        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
                        (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                      }}
                      className={cn('block w-full text-left px-4 py-2.5 text-sm font-medium transition-colors',
                        d('text-white/70 hover:text-white hover:bg-white/5', 'text-black/70 hover:text-black hover:bg-black/5'))}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={onLoginClick}
                    className={cn('block w-full text-left px-4 py-2.5 text-sm font-bold border-t mt-1 pt-3 transition-colors',
                      d('text-white border-white/10 hover:bg-white/5', 'text-black border-black/10 hover:bg-black/5'))}
                  >
                    {isTR ? 'Giriş' : 'Sign in'}
                  </button>
                </div>
              </details>
              {!isLoggedIn ? (
                <>
                  <button onClick={onLoginClick}
                    className={cn('hidden sm:inline-flex text-[13px] font-semibold px-3 py-1.5 whitespace-nowrap transition-colors', d('text-white/65 hover:text-white', 'text-black/65 hover:text-black'))}>
                    {isTR ? 'Giriş' : 'Sign In'}
                  </button>
                  <button onClick={onTryClick}
                    className="bg-brand text-white px-4 py-2 rounded-full text-[13px] font-bold whitespace-nowrap hover:bg-orange-500 transition-all shadow-md shadow-brand/30 active:scale-95 flex items-center gap-1.5">
                    {isTR ? 'Ücretsiz Dene' : 'Try Free'}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <button onClick={onDashboardClick}
                  className="bg-brand text-white px-4 py-2 rounded-full text-[13px] font-bold whitespace-nowrap hover:bg-orange-500 transition-all shadow-md shadow-brand/30 flex items-center gap-1.5">
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  {isTR ? 'Panele Git' : 'Dashboard'}
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main id="main-content">
      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className={cn('relative min-h-screen flex flex-col items-center justify-center pt-24 pb-16 overflow-hidden cetpa-grid-bg')}>
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full blur-[200px] pointer-events-none"
          style={{ background: d('radial-gradient(circle, rgba(255,64,0,0.12) 0%, transparent 70%)', 'radial-gradient(circle, rgba(255,64,0,0.07) 0%, transparent 70%)') }} />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[140px] pointer-events-none"
          style={{ background: d('rgba(255,140,0,0.06)', 'rgba(255,140,0,0.04)') }} />
        <SparkleField count={22} color={d('#ff4000', '#ff6020')} />

        <div className="relative z-10 w-full max-w-5xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold tracking-wide mb-8 uppercase', d('bg-white/4 border-white/10 text-white/70', 'bg-black/4 border-black/10 text-black/60'))}>
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            {isTR ? 'Türkiye\'nin B2B Cloud ERP yazılımı' : 'Turkey\'s B2B Cloud ERP software'}
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.05] mb-6">
            {isTR ? (
              <>İşletmenizin<br /><span className="cetpa-gradient-text">Dijital Omurgası</span></>
            ) : (
              <>Your Business<br /><span className="cetpa-gradient-text">Digital Backbone</span></>
            )}
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className={cn('text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto', d('text-white/50', 'text-black/70'))}>
            {isTR
              ? 'Satış, lojistik, üretim ve muhasebe süreçlerinizi tek platformda yönetin. Shopify, Mikro ve Luca ile tam entegrasyon.'
              : 'Manage sales, logistics, production and accounting on one platform. Full integration with Shopify, Mikro and Luca.'}
          </motion.p>

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
              {isTR ? 'Demo Talep Et' : 'Request Demo'}
            </button>
          </motion.div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            className={cn('text-xs', d('text-white/60', 'text-black/65'))}>
            {isTR ? '✓ Kredi kartı gerekmez · ✓ 14 gün ücretsiz · ✓ İstediğiniz zaman iptal' : '✓ No credit card · ✓ 14-day free trial · ✓ Cancel anytime'}
          </motion.p>

          {/* MacBook mockup */}
          <motion.div
            initial={{ opacity: 0, y: 70 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative mt-14 px-4 sm:px-0"
          >
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3/4 h-24 blur-[60px] pointer-events-none rounded-full"
              style={{ background: 'radial-gradient(ellipse, rgba(255,64,0,0.28) 0%, rgba(255,140,0,0.12) 60%, transparent 100%)' }} />
            <div style={{ perspective: '1800px' }}>
              <div style={{ transform: 'rotateX(4deg)', transformOrigin: 'bottom center' }}>
                <div className="relative mx-auto rounded-t-[18px] rounded-b-[4px] overflow-hidden"
                  style={{ background: d('linear-gradient(180deg, #1c1c1e 0%, #2a2a2e 100%)', 'linear-gradient(180deg, #c8c8cc 0%, #b8b8bc 100%)'), padding: '10px 10px 0', boxShadow: d('inset 0 1px 0 rgba(255,255,255,0.08), 0 -1px 0 rgba(255,255,255,0.04)', 'inset 0 1px 0 rgba(255,255,255,0.6), 0 -1px 0 rgba(0,0,0,0.08)'), maxWidth: '860px', margin: '0 auto' }}>
                  <div className="absolute top-[14px] left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
                    <div className="w-1.5 h-1.5 rounded-full bg-black/40" />
                  </div>
                  <div className="rounded-t-[10px] rounded-b-0 overflow-hidden" style={{ background: '#000', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)' }}>
                    <div style={{ background: d('#111116', '#f0f0f5'), height: '34px', display: 'flex', alignItems: 'center', padding: '0 14px', gap: '8px', borderBottom: d('1px solid rgba(255,255,255,0.06)', '1px solid rgba(0,0,0,0.08)') }}>
                      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f56', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.2)' }} />
                        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.2)' }} />
                        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.2)' }} />
                      </div>
                      <div style={{ flex: 1, background: d('rgba(255,255,255,0.06)', 'rgba(0,0,0,0.07)'), borderRadius: 6, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 40px' }}>
                        <span style={{ fontSize: 10, color: d('rgba(255,255,255,0.35)', 'rgba(0,0,0,0.4)'), fontFamily: 'system-ui, sans-serif', letterSpacing: '0.01em' }}>
                          🔒 app.cetpa.com.tr/dashboard
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        {[0,1,2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: d('rgba(255,255,255,0.15)', 'rgba(0,0,0,0.15)') }} />)}
                      </div>
                    </div>
                    <img src={heroImageUrl} alt="CETPA Dashboard" className="w-full block" style={{ display: 'block', maxHeight: '480px', objectFit: 'cover', objectPosition: 'top' }} width={1024} height={480} fetchPriority="high" loading="eager" />
                  </div>
                </div>
                {/* Klavye/trackpad gövdesi sabit piksel yükseklikte (52px tuş satırı + 60px
                    trackpad) — mobilde ekran görüntüsü ~343px'e küçülürken bu blok küçülmüyor,
                    orantısız/baskın görünüyordu (2026-08-16 mobil denetim). Salt dekoratif
                    olduğundan mobilde tamamen gizlendi, sm ve üstünde aynen kalıyor. */}
                <div className="hidden sm:block mx-auto" style={{ maxWidth: '860px', height: '3px', background: d('linear-gradient(180deg, #000 0%, #1a1a1e 100%)', 'linear-gradient(180deg, #9a9a9e 0%, #b8b8bc 100%)') }} />
                <div className="hidden sm:block mx-auto" style={{ maxWidth: '900px', background: d('linear-gradient(180deg, #2c2c2e 0%, #1c1c1e 100%)', 'linear-gradient(180deg, #d4d4d8 0%, #c8c8cc 100%)'), borderRadius: '0 0 16px 16px', padding: '10px 32px 0', boxShadow: d('0 2px 0 rgba(255,255,255,0.04) inset, 0 40px 80px -20px rgba(0,0,0,0.8)', '0 2px 0 rgba(255,255,255,0.5) inset, 0 40px 80px -20px rgba(0,0,0,0.18)') }}>
                  <div style={{ height: 52, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, opacity: 0.6 }}>
                    {[3, 4, 3].map((_, ri) => (
                      <div key={ri} style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        {Array.from({ length: 10 }).map((_, ki) => (
                          <div key={ki} style={{ height: 5, flex: 1, borderRadius: 2, background: d('rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)') }} />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div style={{ width: 100, height: 60, borderRadius: 10, background: d('rgba(255,255,255,0.06)', 'rgba(0,0,0,0.10)'), margin: '8px auto 10px', border: d('1px solid rgba(255,255,255,0.06)', '1px solid rgba(0,0,0,0.08)') }} />
                </div>
                <div className="hidden sm:block mx-auto" style={{ maxWidth: '920px', height: '1px', background: d('rgba(255,255,255,0.04)', 'rgba(0,0,0,0.06)') }} />
              </div>
            </div>

            {/* Floating stat cards */}
            <div className={cn('absolute left-0 sm:-left-4 lg:-left-10 top-[18%] cetpa-float rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl hidden sm:flex items-center gap-3', d('bg-[#0f0f14]/95 border-white/12 text-white', 'bg-white/95 border-black/10 text-black'))} style={{ animationDelay: '0s', animationDuration: '5s' }}>
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4.5 h-4.5 text-emerald-500" style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest">{isTR ? 'Bu Ay Ciro' : 'Monthly Revenue'}</p>
                <p className="text-base font-black leading-tight mt-0.5">₺2.4M</p>
                <p className="text-[9px] text-emerald-500 font-bold mt-0.5">↑ 12% {isTR ? 'geçen aya göre' : 'vs last month'}</p>
              </div>
            </div>
            <div className={cn('absolute right-0 sm:-right-4 lg:-right-10 top-[12%] cetpa-float rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl hidden sm:flex items-center gap-3', d('bg-[#0f0f14]/95 border-white/12 text-white', 'bg-white/95 border-black/10 text-black'))} style={{ animationDelay: '1.2s', animationDuration: '6s' }}>
              <div className="w-9 h-9 rounded-xl bg-brand/15 flex items-center justify-center flex-shrink-0">
                <Package style={{ width: 18, height: 18 }} className="text-brand" />
              </div>
              <div>
                <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest">{isTR ? 'Aktif Sipariş' : 'Active Orders'}</p>
                <p className="text-base font-black leading-tight mt-0.5">1,247</p>
                <p className="text-[9px] text-brand font-bold mt-0.5">↑ 34 {isTR ? 'bugün eklendi' : 'added today'}</p>
              </div>
            </div>
            <div className={cn('absolute right-2 sm:right-4 lg:-right-6 bottom-[22%] cetpa-float rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl hidden lg:flex items-center gap-3', d('bg-[#0f0f14]/95 border-white/12 text-white', 'bg-white/95 border-black/10 text-black'))} style={{ animationDelay: '2.8s', animationDuration: '7s' }}>
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                <BarChart3 style={{ width: 18, height: 18 }} className="text-violet-500" />
              </div>
              <div>
                <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest">{isTR ? 'AI Lead Skoru' : 'AI Lead Score'}</p>
                <p className="text-base font-black leading-tight mt-0.5">94 / 100</p>
                <div className="w-24 h-1.5 bg-violet-500/20 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full" style={{ width: '94%' }} />
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
                  // Bu satırdaki her değer KODDAN DOĞRULANABİLİR olmalı.
                  // Önceki hâli uydurmaydı (200+ müşteri, ₺2B+ ciro, 50K+ sipariş,
                  // 99.9% uptime, 4.9★, 15+ entegrasyon) — hiçbiri bir ölçümden
                  // gelmiyordu ve "15+ entegrasyon" gerçek sayının (12) üstündeydi.
                  // 26 = useRouteSync TOP_LEVEL_TABS · 12 = /api altındaki entegrasyon önekleri.
                  { label: isTR ? 'modül' : 'modules', val: '26' },
                  { label: isTR ? 'entegrasyon' : 'integrations', val: '12' },
                  { label: 'Logo · SAP · Dynamics', val: 'Mikro' },
                  { label: isTR ? 'GİB entegrasyonu' : 'GİB integration', val: 'e-Fatura' },
                  { label: isTR ? 'bayi portalı' : 'dealer portal', val: 'B2B' },
                  { label: isTR ? 'Türkiye\'de geliştirildi' : 'built in Türkiye', val: 'Antalya' },
                ].map((s, i) => (
                  <div key={i} className="flex items-center gap-3 flex-shrink-0">
                    <SparkleIcon size={10} style={{ color: brand, opacity: 0.5 }} />
                    <span className={cn('text-sm font-black', d('text-white', 'text-black'))}>{s.val}</span>
                    <span className={cn('text-xs', d('text-white/65', 'text-black/70'))}>{s.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Innovation Section (SAP-style animated ring) ───────────────────── */}
      <div id="innovation">
        <InnovationSection
          isTR={isTR} darkMode={darkMode} d={d}
          onTryClick={onTryClick} isLoggedIn={isLoggedIn} onDashboardClick={onDashboardClick}
        />
      </div>

      {/* ── Integrations logos ─────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="w-full max-w-5xl mx-auto px-6 text-center">
          <p className={cn('text-xs font-bold uppercase tracking-widest mb-10', d('text-white/55', 'text-black/60'))}>
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
        <div className="w-full max-w-5xl mx-auto px-6 relative z-10">
          <div className="text-center mb-20">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Nasıl Çalışır' : 'How It Works'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'Üç adımda dijital dönüşüm' : 'Three steps to digital transformation'}
            </h2>
            <p className={cn('max-w-xl mx-auto', d('text-white/65', 'text-black/70'))}>
              {isTR ? 'Karmaşık kurulum yok. Hemen başlayın, aynı gün verim alın.' : 'No complex setup. Start immediately, get results the same day.'}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
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
                    <span className={cn('absolute -top-2 -right-2 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center', d('bg-white/10 text-white/50', 'bg-gray-100 text-black/70'))}>{s.n}</span>
                  </div>
                  <h3 className="text-xl font-black mb-3">{s.title}</h3>
                  <p className={cn('text-sm leading-relaxed', d('text-white/65', 'text-black/70'))}>{s.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Spotlight: CRM & Sales ────────────────────────────────────────── */}
      <SpotlightSection
        isTR={isTR} darkMode={darkMode} d={d}
        eyebrow={isTR ? 'CRM & Satış' : 'CRM & Sales'}
        title={isTR ? 'Müşterilerinizi merkeze alın' : 'Put your customers at the center'}
        desc={isTR
          ? 'AI destekli lead skorlaması, müşteri portföy yönetimi ve satış tahminleri ile satış ekibinizin performansını artırın. B2B ilişkilerini güçlendirin, fırsatları kaçırmayın.'
          : 'Boost your sales team with AI-powered lead scoring, customer portfolio management and sales forecasting. Strengthen B2B relationships and never miss an opportunity.'}
        bullets={isTR
          ? ['AI destekli lead skorlaması ve tahmin', 'B2B müşteri portföy & kredi limiti yönetimi', 'Tekliften siparişe otomatik dönüşüm', 'Satış hedef takibi ve gerçek zamanlı raporlama', 'Pipeline görünümü ve Kanban yönetimi']
          : ['AI-powered lead scoring and forecasting', 'B2B customer portfolio & credit limit management', 'Automatic quote-to-order conversion', 'Sales target tracking and real-time reporting', 'Pipeline view and Kanban management']}
        ctaLabel={isTR ? 'CRM Modülünü Keşfet →' : 'Explore CRM Module →'}
        onCta={isLoggedIn ? (onDashboardClick || onTryClick) : onTryClick}
        reverse={false}
        icon={Users}
        accent="#ff4000"
        stat1={{ value: '%60', label: isTR ? 'daha az manuel iş' : 'less manual work' }}
        stat2={{ value: '%35', label: isTR ? 'daha az müşteri kaybı' : 'less customer churn' }}
      />

      {/* ── Spotlight: Finance & Accounting ──────────────────────────────── */}
      <SpotlightSection
        isTR={isTR} darkMode={darkMode} d={d}
        eyebrow={isTR ? 'Finans & Muhasebe' : 'Finance & Accounting'}
        title={isTR ? 'Finansal operasyonlarınızı otomatikleştirin' : 'Automate your financial operations'}
        desc={isTR
          ? 'e-Fatura, Mikro ERP ve Luca entegrasyonu ile muhasebe süreçlerinizi otomatize edin. Nakit akışını anlık takip edin, ay sonu kapanışını saatlere indirin.'
          : 'Automate your accounting with e-Invoice, Mikro ERP and Luca integration. Track cash flow in real time and reduce month-end close to hours.'}
        bullets={isTR
          ? ['e-Fatura, e-Arşiv ve ihracat faturası', 'Mikro ERP & Luca çift yönlü senkronizasyon', 'Otomatik banka mutabakatı ve çek takibi', 'Gerçek zamanlı nakit akışı ve bütçe analizi', 'Bordro, SGK ve vergi entegrasyonu']
          : ['e-Invoice, e-Archive and export invoice', 'Mikro ERP & Luca two-way synchronization', 'Automatic bank reconciliation and cheque tracking', 'Real-time cash flow and budget analytics', 'Payroll, social security and tax integration']}
        ctaLabel={isTR ? 'Finans Modülünü Keşfet →' : 'Explore Finance Module →'}
        onCta={isLoggedIn ? (onDashboardClick || onTryClick) : onTryClick}
        reverse={true}
        icon={Landmark}
        accent="#3b82f6"
        stat1={{ value: '3sa', label: isTR ? 'ay sonu kapanış' : 'month-end close' }}
        stat2={{ value: '99%', label: isTR ? 'e-fatura uyumu' : 'e-invoice compliance' }}
      />

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="py-32">
        <div className="w-full max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Tüm Modüller' : 'All Modules'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'İşletmenizin her yönü kapsandı' : 'Every aspect of your business covered'}
            </h2>
            <p className={cn('max-w-xl mx-auto', d('text-white/65', 'text-black/70'))}>
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
                  <p className={cn('text-xs leading-relaxed', d('text-white/65', 'text-black/70'))}>{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Spotlight: Logistics ─────────────────────────────────────────── */}
      <SpotlightSection
        isTR={isTR} darkMode={darkMode} d={d}
        eyebrow={isTR ? 'Lojistik & Depo' : 'Logistics & Warehouse'}
        title={isTR ? 'Tedarik zincirinizi görünür kılın' : 'Make your supply chain visible'}
        desc={isTR
          ? 'Çok depolu stok yönetimi, akıllı kargo rotalama ve gerçek zamanlı teslimat takibi ile lojistik operasyonlarınızı optimize edin. Kargo firmalarıyla doğrudan entegrasyon.'
          : 'Optimize logistics with multi-warehouse inventory, smart cargo routing and real-time delivery tracking. Direct integration with cargo companies.'}
        bullets={isTR
          ? ['Çok depolu stok transferi ve barkod okuma', 'Akıllı rotalama ve sürücü atama', 'Tüm kargo şirketleriyle doğrudan entegrasyon', 'Teslimat fotoğrafı ve müşteri bildirimi', 'Kritik stok uyarıları ve otomatik sipariş']
          : ['Multi-warehouse transfer and barcode scanning', 'Smart routing and driver assignment', 'Direct integration with all cargo companies', 'Delivery photo capture and customer notification', 'Critical stock alerts and automatic reorder']}
        ctaLabel={isTR ? 'Lojistik Modülünü Keşfet →' : 'Explore Logistics Module →'}
        onCta={isLoggedIn ? (onDashboardClick || onTryClick) : onTryClick}
        reverse={false}
        icon={Truck}
        accent="#10b981"
        stat1={{ value: '%40', label: isTR ? 'teslimat hızı artışı' : 'faster delivery' }}
        stat2={{ value: '0', label: isTR ? 'kayıp kargo' : 'lost packages' }}
      />

      {/* ── Demo video ───────────────────────────────────────────────────── */}
      <section id="demo" className={cn('py-32 relative overflow-hidden', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: d('radial-gradient(ellipse at center, rgba(255,64,0,0.06) 0%, transparent 70%)', 'radial-gradient(ellipse at center, rgba(255,64,0,0.04) 0%, transparent 70%)') }} />
        <div className="w-full max-w-5xl mx-auto px-6 text-center relative z-10">
          <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Ürün Demosu' : 'Product Demo'}</p>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            {isTR ? 'CETPA\'yı aksiyonda görün' : 'See CETPA in action'}
          </h2>
          <p className={cn('max-w-xl mx-auto mb-12', d('text-white/65', 'text-black/70'))}>
            {isTR ? 'Demo talep edin, ekibimiz size özel bir sunum ayarlasın.' : 'Request a demo and our team will set up a personalized presentation.'}
          </p>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className={cn('relative rounded-3xl border overflow-hidden cursor-pointer group', d('border-white/8', 'border-black/8'))}>
            <img src={heroImageUrl} alt="Demo" className="w-full h-auto blur-[1px] group-hover:blur-0 transition-all duration-500 brightness-75 group-hover:brightness-90" width={1024} height={1024} loading="lazy" />
            <div className="absolute inset-0 flex items-center justify-center">
              <button onClick={onTryClick}
                aria-label={isTR ? 'Demoyu başlat' : 'Start the demo'}
                className="relative w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all duration-300 group-hover:bg-brand">
                <div className="absolute inset-0 rounded-full bg-white/30" style={{ animation: 'cetpa-pulse-ring 2s ease-out infinite' }} />
                <div className="absolute inset-0 rounded-full bg-white/20" style={{ animation: 'cetpa-pulse-ring 2s 0.5s ease-out infinite' }} />
                <Play className="w-8 h-8 text-brand group-hover:text-white transition-colors ml-1" />
              </button>
            </div>
            <div className="absolute bottom-4 right-4 bg-black/70 text-white text-xs font-bold px-3 py-1.5 rounded-xl backdrop-blur-sm flex items-center gap-1.5">
              <Play className="w-3 h-3" /> {isTR ? 'Demo Talep Et' : 'Request Demo'}
            </div>
          </motion.div>

        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      {testimonials.length > 0 && (
      <section className="py-32">
        <div className="w-full max-w-6xl mx-auto px-6">
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
      )}

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className={cn('py-32 relative overflow-hidden', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <SparkleField count={10} color={brand} />
        <div className="w-full max-w-5xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">{isTR ? 'Fiyatlandırma' : 'Pricing'}</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              {isTR ? 'Her ölçek için doğru plan' : 'The right plan for every scale'}
            </h2>
            <div className="inline-flex items-center gap-3 mt-6">
              <span className={cn('text-sm font-semibold', !pricingAnnual && d('text-white/70', 'text-black/70'))}>
                {isTR ? 'Aylık' : 'Monthly'}
              </span>
              <button onClick={() => setPricingAnnual(v => !v)}
                role="switch" aria-checked={pricingAnnual}
                aria-label={isTR ? 'Yıllık faturalandırma' : 'Annual billing'}
                className={cn('relative w-12 h-6 rounded-full transition-colors', pricingAnnual ? 'bg-brand' : d('bg-white/15', 'bg-black/15'))}>
                <div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', pricingAnnual ? 'translate-x-7' : 'translate-x-1')} />
              </button>
              <span className={cn('text-sm font-semibold flex items-center gap-2', pricingAnnual && 'text-brand')}>
                {isTR ? 'Yıllık' : 'Annual'}
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', pricingAnnual ? 'bg-brand/15 text-brand' : d('bg-white/8 text-white/65', 'bg-black/8 text-black/70'))}>
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
                  <p className={cn('text-xs mb-6', d('text-white/65', 'text-black/70'))}>{plan.desc}</p>
                  <div className="mb-8">
                    {price !== null ? (
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-black">{isTR ? '₺' : '$'}{price?.toLocaleString()}</span>
                        <span className={cn('text-sm', d('text-white/65', 'text-black/70'))}>{isTR ? '/ay' : '/mo'}</span>
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

      {/* ── Accountant Partner Program ───────────────────────────────────── */}
      <AccountantPartnerSection isTR={isTR} d={d} darkMode={darkMode} />

      {/* ── Industries ───────────────────────────────────────────────────── */}
      <section id="solutions" className="py-32">
        <div className="w-full max-w-6xl mx-auto px-6">
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
                <p className={cn('text-xs leading-relaxed', d('text-white/65', 'text-black/70'))}>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ICP Persona Selector ─────────────────────────────────────────── */}
      <IcpSection isTR={isTR} d={d} darkMode={darkMode} />

      {/* ── Competitor Comparison ────────────────────────────────────────── */}
      <CompetitorSection isTR={isTR} d={d} darkMode={darkMode} />

      {/* ── ROI Calculator ───────────────────────────────────────────────── */}
      <RoiSection isTR={isTR} d={d} darkMode={darkMode} onTryClick={onTryClick} />

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className={cn('py-32', d('bg-white/[0.015]', 'bg-black/[0.015]'))}>
        <div className="w-full max-w-2xl mx-auto px-6">
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

      {/* ── Bold Statement (Zera-inspired) ───────────────────────────── */}
      <section className="py-24 overflow-hidden">
        <div className="w-full max-w-6xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className={cn('relative rounded-[2.5rem] overflow-hidden p-8 sm:p-14 md:p-20 cetpa-noise cetpa-grid-bg', d('bg-[#0b0b14]','bg-white border border-black/8 shadow-xl'))}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(255,64,0,0.12) 0%, transparent 65%)' }} />
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
              {/* Left: statement */}
              <div className="flex-1 max-w-2xl">
                <p className={cn('text-xs font-black uppercase tracking-widest mb-6', 'text-brand')}>{isTR ? 'Gerçek şu ki' : 'The truth is'}</p>
                <h2 className={cn('text-3xl md:text-5xl font-black tracking-tight leading-[1.1]', d('text-white','text-[#111]'))}>
                  {isTR
                    ? <>"Operasyonlarınız bağlı değilse,<br /><span className="cetpa-gradient-text">fiyat yarışında</span> her zaman geride kalırsınız."</>
                    : <>"If your operations aren't connected, you'll always<br /><span className="cetpa-gradient-text">compete on price alone."</span></>
                  }
                </h2>
                <p className={cn('mt-6 text-sm leading-relaxed max-w-lg', d('text-white/65','text-black/70'))}>
                  {isTR
                    ? 'Veriyi silolarda tutmak, müşteri deneyimini ve marjları ezer. CETPA tüm departmanları tek bir gerçek kaynağında birleştirir.'
                    : 'Siloed data crushes customer experience and margins. CETPA unifies every department into one source of truth.'
                  }
                </p>
              </div>

            </div>
          </motion.div>
        </div>
      </section>

      {/* ── What's Inside: Numbered Modules ──────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-black uppercase tracking-widest text-brand mb-3">{isTR ? 'Modüller' : "What's Inside"}</p>
            <h2 className={cn('text-3xl md:text-5xl font-black tracking-tight', d('text-white','text-[#111]'))}>
              {isTR ? '26 entegre modül, sıfır silo' : '26 integrated modules. Zero silos.'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {([
              { n:'01', label: isTR ? 'Dashboard & Analitik'         : 'Dashboard & Analytics',      icon:'📊' },
              { n:'02', label: isTR ? 'CRM & Satış Yönetimi'         : 'CRM & Sales Management',     icon:'🤝' },
              { n:'03', label: isTR ? 'Sipariş & Fatura Yönetimi'    : 'Order & Invoice Management',  icon:'📦' },
              { n:'04', label: isTR ? 'Envanter & Depo'              : 'Inventory & Warehouse',       icon:'📋' },
              { n:'05', label: isTR ? 'Muhasebe & Finans'            : 'Accounting & Finance',        icon:'💰' },
              { n:'06', label: isTR ? 'Lojistik & Kargo'             : 'Logistics & Cargo',           icon:'🚛' },
              { n:'07', label: isTR ? 'Satın Alma & Tedarik'         : 'Purchasing & Procurement',    icon:'🛒' },
              { n:'08', label: isTR ? 'B2B & Bayi Portalı'           : 'B2B & Dealer Portal',         icon:'🏪' },
              { n:'09', label: isTR ? 'Üretim & BOM'                 : 'Production & BOM',            icon:'🏭' },
              { n:'10', label: isTR ? 'İnsan Kaynakları'             : 'Human Resources',             icon:'👥' },
              { n:'11', label: isTR ? 'Hukuk & Uyum'                 : 'Legal & Compliance',          icon:'⚖️' },
              { n:'12', label: isTR ? 'Kalite Kontrol'               : 'Quality Control',             icon:'✅' },
              { n:'13', label: isTR ? 'Proje Yönetimi'               : 'Project Management',          icon:'📐' },
              { n:'14', label: isTR ? 'Risk Yönetimi'                : 'Risk Management',             icon:'🛡️' },
              { n:'15', label: isTR ? 'Kurumsal Yönetişim'           : 'Corporate Governance',        icon:'🏛️' },
              { n:'16', label: isTR ? 'Raporlar & BI'                : 'Reports & BI',                icon:'📈' },
              { n:'17', label: isTR ? 'Entegrasyonlar (Shopify, Mikro, Luca)' : 'Integrations (Shopify, Mikro, Luca)', icon:'🔌' },
              { n:'18', label: isTR ? 'AI Asistan & Otomasyon'       : 'AI Assistant & Automation',   icon:'🤖' },
            ] as {n:string;label:string;icon:string}[]).map((mod, i) => (
              <motion.div key={mod.n} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 3) * 0.06 }}
                className={cn('group flex items-center gap-4 p-4 rounded-2xl border transition-all cetpa-card-glow cursor-default',
                  d('bg-white/[0.025] border-white/8 hover:bg-white/[0.05]','bg-white border-black/8 hover:border-brand/20 shadow-sm'))}>
                <span className="text-xl flex-shrink-0">{mod.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-xs font-black', d('text-white/80','text-[#111]'))}>{mod.label}</p>
                </div>
                <span className={cn('text-[10px] font-black tabular-nums shrink-0', d('text-white/50','text-black/55'))}>{mod.n}</span>
              </motion.div>
            ))}
          </div>
          <div className="text-center mt-10">
            <div className={cn('inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold border', d('border-white/10 text-white/65','border-black/10 text-black/70'))}>
              {isTR ? '🔒 Enterprise planında tüm modüller açık + özel geliştirme' : '🔒 Enterprise plan unlocks all modules + custom development'}
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="py-32 px-4">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="relative rounded-[3rem] overflow-hidden p-8 sm:p-16 md:p-24 text-center cetpa-noise"
            style={{ background: d('linear-gradient(135deg, #0f0a08 0%, #1a0800 30%, #0f0a08 100%)', 'linear-gradient(135deg, #fff5f0 0%, #fff0e8 50%, #fff5f0 100%)') }}>
            <div className="absolute inset-0 rounded-[3rem] pointer-events-none" style={{ background: 'linear-gradient(135deg, rgba(255,64,0,0.3) 0%, transparent 50%, rgba(255,140,0,0.2) 100%)', WebkitMask: 'padding-box, border-box', padding: '1px' }} />
            <SparkleField count={16} color={brand} />
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
              <p className={cn('text-lg mb-10 max-w-xl mx-auto', d('text-white/50', 'text-black/70'))}>
                {isTR ? '14 gün ücretsiz, kredi kartı gerekmez. İstediğiniz zaman iptal edin.' : '14 days free, no credit card required. Cancel anytime.'}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button onClick={isLoggedIn ? onDashboardClick : onTryClick}
                  className="group w-full sm:w-auto px-10 py-5 rounded-2xl bg-brand text-white font-black text-lg shadow-2xl shadow-brand/40 hover:bg-orange-500 hover:scale-105 transition-all active:scale-95 flex items-center justify-center gap-3">
                  {isTR ? 'Ücretsiz Başla' : 'Start for Free'}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <a href="mailto:info@cetpa.com.tr"
                  className={cn('w-full sm:w-auto px-10 py-5 rounded-2xl font-bold text-lg border transition-all hover:scale-105 flex items-center justify-center gap-3', d('border-white/15 text-white hover:bg-white/8', 'border-black/12 text-black hover:bg-black/5'))}>
                  <Mail className="w-5 h-5" />
                  {isTR ? 'Demo Talebi' : 'Request Demo'}
                </a>
              </div>
              <p className={cn('text-xs mt-6', d('text-white/55', 'text-black/60'))}>
                {isTR ? 'veya bize yazın: info@cetpa.com.tr' : 'or write to us: info@cetpa.com.tr'}
              </p>
            </div>
          </motion.div>
        </div>
      </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className={cn('border-t pt-16 pb-10', d('border-white/6', 'border-black/6'))}>
        <div className="w-full max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
            <div className="col-span-2 md:col-span-1">
              <img src="/cetpalogo.avif" alt="CETPA" className="h-7 mb-4" />
              <p className={cn('text-xs leading-relaxed mb-4', d('text-white/60', 'text-black/65'))}>
                {isTR ? 'Türkiye\'nin B2B Cloud ERP platformu.' : "Turkey's B2B Cloud ERP platform."}
              </p>

            </div>
            {/* ── Product column ── */}
            <div>
              <p className={cn('text-xs font-black uppercase tracking-wider mb-4', d('text-white/55', 'text-black/60'))}>{isTR ? 'Ürün' : 'Product'}</p>
              <div className="space-y-3">
                <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                  className={cn('block text-xs transition-colors cursor-pointer', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Özellikler' : 'Features'}
                </button>
                <button onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                  className={cn('block text-xs transition-colors cursor-pointer', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Fiyatlar' : 'Pricing'}
                </button>
                <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
                  className={cn('block text-xs transition-colors cursor-pointer', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Nasıl Çalışır' : 'How It Works'}
                </button>
                <Link to={PUBLIC_PATHS.developers}
                  className={cn('block text-xs transition-colors', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  API
                </Link>
              </div>
            </div>

            {/* ── Company column ── */}
            <div>
              <p className={cn('text-xs font-black uppercase tracking-wider mb-4', d('text-white/55', 'text-black/60'))}>{isTR ? 'Şirket' : 'Company'}</p>
              <div className="space-y-3">
                <button onClick={() => document.getElementById('solutions')?.scrollIntoView({ behavior: 'smooth' })}
                  className={cn('block text-xs transition-colors cursor-pointer', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Sektörler' : 'Industries'}
                </button>
                <Link to={PUBLIC_PATHS.careers}
                  className={cn('block text-xs transition-colors', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Kariyer' : 'Careers'}
                </Link>
                <Link to={PUBLIC_PATHS.blog}
                  className={cn('block text-xs transition-colors', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  Blog
                </Link>
                <a href="mailto:info@cetpa.com.tr?subject=Basin"
                  className={cn('block text-xs transition-colors', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Basın' : 'Press'}
                </a>
              </div>
            </div>

            {/* ── Legal column ── */}
            <div>
              <p className={cn('text-xs font-black uppercase tracking-wider mb-4', d('text-white/55', 'text-black/60'))}>{isTR ? 'Yasal' : 'Legal'}</p>
              <div className="space-y-3">
                <Link to={PUBLIC_PATHS.privacy}
                  className={cn('block text-xs transition-colors cursor-pointer', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Gizlilik Politikası' : 'Privacy Policy'}
                </Link>
                <Link to={PUBLIC_PATHS.terms}
                  className={cn('block text-xs transition-colors cursor-pointer', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  {isTR ? 'Kullanım Koşulları' : 'Terms of Service'}
                </Link>
                <a href="mailto:info@cetpa.com.tr"
                  className={cn('block text-xs transition-colors', d('text-white/60 hover:text-white', 'text-black/65 hover:text-black'))}>
                  info@cetpa.com.tr
                </a>
              </div>
            </div>
          </div>

          {/* ── Bottom bar ── */}
          <div className={cn('pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4', d('border-white/6', 'border-black/6'))}>
            <p className={cn('text-xs', d('text-white/55', 'text-black/60'))}>© 2026 CETPA A.Ş. {isTR ? 'Tüm hakları saklıdır.' : 'All rights reserved.'}</p>
            <div className="flex items-center gap-1.5">
              <span className={cn('text-xs', d('text-white/55', 'text-black/60'))}>
                {isTR ? 'CETPA tarafından' : 'Made by CETPA with'}
              </span>
              <span className="text-brand text-sm leading-none">❤</span>
              <span className={cn('text-xs', d('text-white/55', 'text-black/60'))}>
                {isTR ? "Antalya'da yapıldı" : "in Antalya"}
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
