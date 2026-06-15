import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, ArrowRight, Building2, Rocket, Sparkles, Plug, Server, Cloud, Download } from 'lucide-react';
import { PLANS, type SubscriptionPlan, createTrialSubscription, type UserSubscription } from '../types/subscription';
import { doc, setDoc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';

interface OnboardingFlowProps {
  currentLanguage: 'tr' | 'en';
  onComplete: (subscription: UserSubscription, companyInfo: { name: string; sector: string; size: string }) => void;
}

const SECTORS = {
  tr: ['Üretim', 'Perakende', 'Lojistik', 'Teknoloji', 'Gıda', 'Tekstil', 'İnşaat', 'Otomotiv', 'Sağlık', 'Diğer'],
  en: ['Manufacturing', 'Retail', 'Logistics', 'Technology', 'Food', 'Textile', 'Construction', 'Automotive', 'Healthcare', 'Other'],
};

const SIZES = {
  tr: ['1-5 Kişi', '6-20 Kişi', '21-50 Kişi', '51-200 Kişi', '200+ Kişi'],
  en: ['1-5 People', '6-20 People', '21-50 People', '51-200 People', '200+ People'],
};

export default function OnboardingFlow({ currentLanguage, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [sector, setSector] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>('professional');
  // Entegrasyon & dağıtım (yeni adım)
  const [erpChoice, setErpChoice] = useState<'mikro' | 'parasut' | 'none'>('none');
  const [deployMode, setDeployMode] = useState<'saas' | 'self-hosted'>('saas');
  const [vps, setVps] = useState({ host: '', domain: '', dbPassword: '' });
  const lang = currentLanguage;

  const steps = [
    { icon: Sparkles, title: lang === 'tr' ? 'Hoş Geldiniz!' : 'Welcome!' },
    { icon: Building2, title: lang === 'tr' ? 'Şirket Bilgileri' : 'Company Info' },
    { icon: Rocket, title: lang === 'tr' ? 'Plan Seçimi' : 'Choose Plan' },
    { icon: Plug, title: lang === 'tr' ? 'Entegrasyon & Kurulum' : 'Integration & Setup' },
    { icon: Check, title: lang === 'tr' ? 'Hazırsınız!' : 'You\'re Ready!' },
  ];

  // Self-hosted için deploy paketi (.env + docker-compose) üret ve indir
  const downloadDeployBundle = () => {
    const dbPass = vps.dbPassword || 'CHANGE_ME_' + Math.random().toString(36).slice(2, 10);
    const env = [
      `# CETPA — ${companyName || 'firma'} kurulum env'i (${new Date().toISOString().slice(0, 10)})`,
      `NODE_ENV=production`,
      `PORT=5173`,
      `DATABASE_URL=postgresql://cetpa:${dbPass}@/cetpa_db?host=/var/run/postgresql`,
      `# Firebase Auth + Storage (kendi projenizi girin)`,
      `FIREBASE_CLIENT_EMAIL=`,
      `FIREBASE_PRIVATE_KEY=`,
      `SESSION_TOKEN_SECRET=${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
      `MFA_COOKIE_SECRET=${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
      erpChoice === 'mikro' ? `# Mikro ERP creds\nMIKRO_IDM_EMAIL=\nMIKRO_IDM_PASSWORD=\nMIKRO_ALIAS=\nMIKRO_API_KEY=` : '',
      erpChoice === 'parasut' ? `# Paraşüt creds\nPARASUT_CLIENT_ID=\nPARASUT_CLIENT_SECRET=\nPARASUT_USERNAME=\nPARASUT_PASSWORD=\nPARASUT_COMPANY_ID=` : '',
    ].filter(Boolean).join('\n');
    const compose = `services:
  app:
    build: .
    container_name: cetpa-app
    ports: ["127.0.0.1:5173:5173"]
    env_file: [.env.production]
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes:
      - /var/run/postgresql:/var/run/postgresql
      - ./backups:/app/backups
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:5173/api/health"]
      interval: 30s
`;
    const readme = `# ${companyName || 'CETPA'} — Self-Hosted Kurulum\n\nHedef: ${vps.host || 'VPS'} → ${vps.domain || 'alan adınız'}\n\n1. VPS'e Docker + PostgreSQL 15 kurun (cetpa_db + cetpa kullanıcısı).\n2. .env.production'ı doldurun (Firebase + ERP creds).\n3. docker compose up -d --build\n4. Nginx reverse proxy + SSL (certbot) ayarlayın → ${vps.domain || 'domain'}.\n`;
    const bundle = `===== .env.production =====\n${env}\n\n===== docker-compose.yml =====\n${compose}\n===== KURULUM.md =====\n${readme}`;
    const blob = new Blob([bundle], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cetpa-deploy-${(companyName || 'firma').toLowerCase().replace(/\s+/g, '-')}.txt`;
    a.click();
  };

  const handleComplete = () => {
    // Entegrasyon + dağıtım seçimini kaydet (settings — App'i değiştirmeden)
    void (async () => {
      try {
        await setDoc(doc(db, 'settings', 'companyProfile'), {
          name: companyName, sector, size: companySize,
          deployMode, erp: erpChoice, onboardedAt: serverTimestamp(),
        }, { merge: true });
        if (erpChoice !== 'none') {
          await setDoc(doc(db, 'settings', 'erpHub'), { activeErp: erpChoice }, { merge: true });
          await setDoc(doc(db, 'settings', erpChoice), { enabled: true }, { merge: true });
        }
      } catch { /* non-critical */ }
    })();
    const subscription = createTrialSubscription(selectedPlan);
    onComplete(subscription, { name: companyName, sector, size: companySize });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0a] via-[#1a0800] to-[#0a0a0a]" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-[#ff4000]/20 rounded-full blur-[150px] animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="relative z-10 w-full max-w-2xl mx-4">
        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                i < step ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                i === step ? 'bg-[#ff4000] text-white shadow-lg shadow-[#ff4000]/30' :
                'bg-white/10 text-white/30 border border-white/10'
              }`}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-12 sm:w-20 h-0.5 rounded transition-all duration-500 ${i < step ? 'bg-green-500/30' : 'bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4 }}
              className="bg-white/[0.06] backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-12 text-center"
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="w-24 h-24 bg-gradient-to-br from-[#ff4000] to-[#ff6b35] rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-[#ff4000]/30"
              >
                <img src="/cetpalogo.avif" alt="CETPA" className="h-12 w-auto object-contain" />
              </motion.div>
              <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
                {lang === 'tr' ? 'Cetpa\'ya Hoş Geldiniz!' : 'Welcome to Cetpa!'}
              </h2>
              <p className="text-white/50 text-lg mb-2">
                {lang === 'tr'
                  ? 'İşletmenizi yönetmenin en akıllı yolu.'
                  : 'The smartest way to manage your business.'}
              </p>
              <p className="text-white/30 text-sm mb-8">
                {lang === 'tr'
                  ? 'Birkaç adımda hesabınızı kuralım ve 14 gün ücretsiz başlayın.'
                  : 'Let\'s set up your account in a few steps and start your 14-day free trial.'}
              </p>
              <button
                onClick={() => setStep(1)}
                className="bg-[#ff4000] hover:bg-[#ff4000]/90 active:scale-[0.98] text-white font-bold py-4 px-10 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/30 inline-flex items-center gap-3 text-lg"
              >
                {lang === 'tr' ? 'Hadi Başlayalım' : 'Let\'s Get Started'}
                <ArrowRight className="w-5 h-5" />
              </button>
            </motion.div>
          )}

          {/* Step 1: Company Info */}
          {step === 1 && (
            <motion.div
              key="company"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4 }}
              className="bg-white/[0.06] backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-12"
            >
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-7 h-7 text-blue-400" />
                </div>
                <h2 className="text-2xl font-black text-white mb-2">
                  {lang === 'tr' ? 'Şirketinizi Tanıyalım' : 'Tell Us About Your Company'}
                </h2>
                <p className="text-white/40 text-sm">
                  {lang === 'tr' ? 'Deneyiminizi kişiselleştirmek için birkaç bilgi.' : 'A few details to personalize your experience.'}
                </p>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                    {lang === 'tr' ? 'Şirket Adı' : 'Company Name'}
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder={lang === 'tr' ? 'Örn: Cetpa A.Ş.' : 'e.g. Cetpa Inc.'}
                    className="w-full bg-white/10 border border-white/20 rounded-2xl px-5 py-3.5 text-white placeholder-white/30 outline-none focus:border-[#ff4000]/50 focus:ring-2 focus:ring-[#ff4000]/20 transition-all text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                    {lang === 'tr' ? 'Sektör' : 'Industry'}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {SECTORS[lang].map(s => (
                      <button
                        key={s}
                        onClick={() => setSector(s)}
                        className={`text-xs font-bold py-2.5 px-3 rounded-xl border transition-all ${
                          sector === s
                            ? 'bg-[#ff4000]/20 border-[#ff4000]/40 text-[#ff4000]'
                            : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30 hover:text-white/80'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                    {lang === 'tr' ? 'Şirket Büyüklüğü' : 'Company Size'}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SIZES[lang].map(s => (
                      <button
                        key={s}
                        onClick={() => setCompanySize(s)}
                        className={`text-xs font-bold py-2.5 px-4 rounded-xl border transition-all ${
                          companySize === s
                            ? 'bg-[#ff4000]/20 border-[#ff4000]/40 text-[#ff4000]'
                            : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30 hover:text-white/80'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between mt-8">
                <button onClick={() => setStep(0)} className="text-white/40 hover:text-white/70 text-sm font-medium transition-colors">
                  {lang === 'tr' ? '← Geri' : '← Back'}
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!companyName.trim()}
                  className="bg-[#ff4000] hover:bg-[#ff4000]/90 active:scale-[0.98] text-white font-bold py-3 px-8 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/30 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {lang === 'tr' ? 'Devam' : 'Continue'} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Plan Selection */}
          {step === 2 && (
            <motion.div
              key="plan"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4 }}
              className="bg-white/[0.06] backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-12"
            >
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-[#ff4000]/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Rocket className="w-7 h-7 text-[#ff4000]" />
                </div>
                <h2 className="text-2xl font-black text-white mb-2">
                  {lang === 'tr' ? 'Planınızı Seçin' : 'Choose Your Plan'}
                </h2>
                <p className="text-white/40 text-sm">
                  {lang === 'tr' ? '14 gün tüm özellikleri ücretsiz deneyin. Kredi kartı gerekmez.' : '14-day free trial with full features. No credit card required.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PLANS.filter(p => !p.isCustomPricing).map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`text-left p-5 rounded-2xl border-2 transition-all ${
                      selectedPlan === plan.id
                        ? 'border-[#ff4000] bg-[#ff4000]/10 shadow-lg shadow-[#ff4000]/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{plan.icon}</span>
                      <div>
                        <h4 className="text-white font-bold text-sm">{plan.name[lang]}</h4>
                        <p className="text-white/40 text-xs">{plan.subtitle[lang]}</p>
                      </div>
                      {selectedPlan === plan.id && (
                        <Check className="w-5 h-5 text-[#ff4000] ml-auto" />
                      )}
                    </div>
                    <p className="text-white/60 text-xs">
                      ₺{plan.monthlyPrice.toLocaleString('tr-TR')}/{lang === 'tr' ? 'ay' : 'mo'} · {plan.maxUsers} {lang === 'tr' ? 'kullanıcı' : 'users'}
                    </p>
                    <p className="text-[#ff4000]/70 text-[10px] font-bold mt-1">
                      {plan.modulesAllowed.length} {lang === 'tr' ? 'modül dahil' : 'modules included'}
                    </p>
                  </button>
                ))}
              </div>

              <div className="flex justify-between mt-8">
                <button onClick={() => setStep(1)} className="text-white/40 hover:text-white/70 text-sm font-medium transition-colors">
                  {lang === 'tr' ? '← Geri' : '← Back'}
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="bg-[#ff4000] hover:bg-[#ff4000]/90 active:scale-[0.98] text-white font-bold py-3 px-8 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/30 inline-flex items-center gap-2"
                >
                  {lang === 'tr' ? 'Devam' : 'Continue'} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Entegrasyon & Kurulum */}
          {step === 3 && (
            <motion.div key="erp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="bg-white/[0.06] backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-10">
              <h2 className="text-2xl font-black text-white mb-1">{lang === 'tr' ? 'Entegrasyon & Kurulum' : 'Integration & Setup'}</h2>
              <p className="text-white/50 text-sm mb-6">{lang === 'tr' ? 'Muhasebe entegrasyonunuzu ve dağıtım modelinizi seçin.' : 'Choose your accounting integration and deployment model.'}</p>

              {/* ERP seçimi */}
              <p className="text-xs font-bold text-white/40 uppercase mb-2">{lang === 'tr' ? 'Muhasebe Entegrasyonu' : 'Accounting Integration'}</p>
              <div className="grid grid-cols-3 gap-2 mb-6">
                {([['mikro', '💼 Mikro'], ['parasut', '🪂 Paraşüt'], ['none', lang === 'tr' ? '⏭ Sonra' : '⏭ Later']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setErpChoice(id)}
                    className={`py-3 rounded-xl text-sm font-bold transition-all border ${erpChoice === id ? 'bg-[#ff4000] text-white border-[#ff4000]' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Dağıtım modeli */}
              <p className="text-xs font-bold text-white/40 uppercase mb-2">{lang === 'tr' ? 'Dağıtım Modeli' : 'Deployment Model'}</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button onClick={() => setDeployMode('saas')}
                  className={`p-4 rounded-xl text-left transition-all border ${deployMode === 'saas' ? 'bg-[#ff4000]/20 border-[#ff4000]' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                  <Cloud className="w-5 h-5 text-white mb-1" />
                  <p className="text-sm font-bold text-white">{lang === 'tr' ? 'Bulut (SaaS)' : 'Cloud (SaaS)'}</p>
                  <p className="text-[11px] text-white/50">{lang === 'tr' ? 'Anında hazır, bizim sunucumuzda' : 'Instant, on our servers'}</p>
                </button>
                <button onClick={() => setDeployMode('self-hosted')}
                  className={`p-4 rounded-xl text-left transition-all border ${deployMode === 'self-hosted' ? 'bg-[#ff4000]/20 border-[#ff4000]' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                  <Server className="w-5 h-5 text-white mb-1" />
                  <p className="text-sm font-bold text-white">{lang === 'tr' ? 'Kendi Sunucum' : 'Self-Hosted'}</p>
                  <p className="text-[11px] text-white/50">{lang === 'tr' ? 'Kendi VPS\'inize Docker ile' : 'Your own VPS via Docker'}</p>
                </button>
              </div>

              {/* Self-hosted alanları + deploy paketi */}
              {deployMode === 'self-hosted' && (
                <div className="bg-white/5 rounded-xl p-4 space-y-2 mb-4">
                  <input value={vps.host} onChange={e => setVps(v => ({ ...v, host: e.target.value }))}
                    placeholder={lang === 'tr' ? 'VPS IP / host (örn. 1.2.3.4)' : 'VPS IP / host'}
                    className="w-full px-3 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/30 outline-none" />
                  <input value={vps.domain} onChange={e => setVps(v => ({ ...v, domain: e.target.value }))}
                    placeholder={lang === 'tr' ? 'Alan adı (örn. erp.firmaniz.com)' : 'Domain'}
                    className="w-full px-3 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/30 outline-none" />
                  <button onClick={downloadDeployBundle}
                    className="w-full apple-button-secondary justify-center py-2.5 text-sm bg-white/10 text-white border-white/20 hover:bg-white/20">
                    <Download className="w-4 h-4" /> {lang === 'tr' ? 'Deploy Paketini İndir (.env + docker-compose)' : 'Download Deploy Bundle'}
                  </button>
                  <p className="text-[10px] text-white/40">{lang === 'tr' ? 'Paketi VPS\'inize kopyalayıp docker compose up ile başlatın. SSH otomasyonu yakında.' : 'Copy to your VPS and run docker compose up. SSH automation coming soon.'}</p>
                </div>
              )}

              <div className="flex justify-between mt-4">
                <button onClick={() => setStep(2)} className="text-white/40 hover:text-white/70 text-sm font-medium transition-colors">
                  {lang === 'tr' ? '← Geri' : '← Back'}
                </button>
                <button onClick={() => setStep(4)}
                  className="bg-[#ff4000] hover:bg-[#ff4000]/90 active:scale-[0.98] text-white font-bold py-3 px-8 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/30 inline-flex items-center gap-2">
                  {lang === 'tr' ? '14 Gün Ücretsiz Başla' : 'Start 14-Day Trial'} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 4: Done — Confetti */}
          {step === 4 && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="bg-white/[0.06] backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-12 text-center relative overflow-hidden"
            >
              {/* Confetti particles */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {Array.from({ length: 30 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{
                      x: '50%',
                      y: '20%',
                      scale: 0,
                      rotate: 0,
                    }}
                    animate={{
                      x: `${Math.random() * 100}%`,
                      y: `${80 + Math.random() * 40}%`,
                      scale: [0, 1, 0.5],
                      rotate: Math.random() * 720 - 360,
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 2 + Math.random(),
                      delay: Math.random() * 0.5,
                      ease: 'easeOut',
                    }}
                    className="absolute w-2 h-2 rounded-sm"
                    style={{
                      background: ['#ff4000', '#ff6b35', '#22c55e', '#3b82f6', '#a855f7', '#eab308'][Math.floor(Math.random() * 6)],
                    }}
                  />
                ))}
              </div>

              <div className="relative z-10">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
                  className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6"
                >
                  <Check className="w-10 h-10 text-green-400" />
                </motion.div>
                <h2 className="text-3xl font-black text-white mb-3">
                  {lang === 'tr' ? 'Her Şey Hazır! 🎉' : 'All Set! 🎉'}
                </h2>
                <p className="text-white/50 text-lg mb-2">
                  {lang === 'tr'
                    ? `${companyName} için ${PLANS.find(p => p.id === selectedPlan)?.name[lang]} planı aktif edildi.`
                    : `${PLANS.find(p => p.id === selectedPlan)?.name[lang]} plan activated for ${companyName}.`}
                </p>
                <p className="text-white/30 text-sm mb-8">
                  {lang === 'tr'
                    ? '14 günlük ücretsiz deneme süreniz başladı. Kredi kartı gerekmez.'
                    : 'Your 14-day free trial has started. No credit card required.'}
                </p>
                <button
                  onClick={handleComplete}
                  className="bg-[#ff4000] hover:bg-[#ff4000]/90 active:scale-[0.98] text-white font-bold py-4 px-10 rounded-2xl transition-all shadow-lg shadow-[#ff4000]/30 text-lg inline-flex items-center gap-3"
                >
                  {lang === 'tr' ? 'Dashboard\'a Git' : 'Go to Dashboard'}
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
