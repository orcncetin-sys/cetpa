import { useEffect } from 'react';
import { ArrowLeft, Heart, Zap, Eye, Trophy, MapPin, Clock, Mail } from 'lucide-react';

interface Props {
  currentLanguage: 'tr' | 'en';
  darkMode: boolean;
  onBack: () => void;
}

export default function CareerPage({ currentLanguage: lang, darkMode, onBack }: Props) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const isTR = lang === 'tr';
  const bg = darkMode ? 'bg-[#0a0a0a] text-[#f5f5f7]' : 'bg-white text-[#1D1D1F]';
  const muted = darkMode ? 'text-white/65' : 'text-black/70';
  const border = darkMode ? 'border-white/8' : 'border-black/8';
  const card = darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-100';

  const values = isTR ? [
    { icon: Heart, title: 'Müşteri Odaklılık', description: 'Her kararı, 200+ aktif müşterimizin işini kolaylaştırıp kolaylaştırmayacağını sorarak veririz.' },
    { icon: Zap, title: 'Hız', description: 'Küçük bir ekibiz ve bunu avantaja çeviririz: hızlı karar alır, hızlı geliştirir, hızlı yayınlarız.' },
    { icon: Eye, title: 'Şeffaflık', description: 'Ekip içinde de müşterilerimizle de net konuşuruz; sorunları saklamak yerine birlikte çözeriz.' },
    { icon: Trophy, title: 'Sahiplenme', description: 'Görevin sınırını değil sonucunu düşünürüz. İşin sahibi biziz, mazeret değil çözüm üretiriz.' },
  ] : [
    { icon: Heart, title: 'Customer Obsession', description: 'We make every decision by asking whether it truly helps our 200+ active customers run their business.' },
    { icon: Zap, title: 'Speed', description: 'We are a small team and we use that as an advantage: fast decisions, fast development, fast releases.' },
    { icon: Eye, title: 'Transparency', description: 'We speak openly, both within the team and with our customers, and solve problems together instead of hiding them.' },
    { icon: Trophy, title: 'Ownership', description: 'We think about outcomes, not job descriptions. We own the work and bring solutions, not excuses.' },
  ];

  const positions = isTR ? [
    { title: 'Full Stack Developer', location: 'Antalya / Uzaktan', type: 'Tam Zamanlı' },
    { title: 'Backend Developer / Node.js', location: 'Antalya / Uzaktan', type: 'Tam Zamanlı' },
    { title: 'Müşteri Başarı Uzmanı', location: 'Antalya / Uzaktan', type: 'Tam Zamanlı' },
    { title: 'Satış Temsilcisi', location: 'Antalya / Uzaktan', type: 'Tam Zamanlı' },
  ] : [
    { title: 'Full Stack Developer', location: 'Antalya / Remote', type: 'Full-time' },
    { title: 'Backend Developer / Node.js', location: 'Antalya / Remote', type: 'Full-time' },
    { title: 'Customer Success Specialist', location: 'Antalya / Remote', type: 'Full-time' },
    { title: 'Sales Representative', location: 'Antalya / Remote', type: 'Full-time' },
  ];

  const applyHref = (title: string) => {
    const subject = isTR ? `${title} Başvurusu` : `${title} Application`;
    return `mailto:info@cetpa.com.tr?subject=${encodeURIComponent(subject)}`;
  };

  const generalApplyHref = `mailto:info@cetpa.com.tr?subject=${encodeURIComponent(isTR ? 'Genel Başvuru' : 'General Application')}`;

  return (
    <div className={`min-h-screen ${bg}`}>
      <header className={`sticky top-0 z-50 border-b ${border} backdrop-blur-xl ${darkMode ? 'bg-[#0a0a0a]/80' : 'bg-white/80'}`}>
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-4">
          <button
            onClick={onBack}
            className={`flex items-center gap-2 text-sm font-medium transition-colors outline-none ${darkMode ? 'text-white/60 hover:text-white' : 'text-black/60 hover:text-black'}`}
          >
            <ArrowLeft className="w-4 h-4" />
            {isTR ? 'Geri' : 'Back'}
          </button>
          <div className="w-px h-4 bg-current opacity-20" />
          <span className="text-sm font-bold" style={{ color: '#ff4000' }}>CETPA</span>
          <span className={`text-sm font-medium ${muted}`}>{isTR ? 'Kariyer' : 'Careers'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${muted}`}>{isTR ? 'Kariyer' : 'Careers'}</p>
          <h1 className="text-4xl font-bold mb-4">{isTR ? 'CETPA\'da Kariyer' : 'Careers at CETPA'}</h1>
          <p className={`leading-relaxed ${muted}`}>
            {isTR
              ? 'CETPA, Antalya merkezli, Türkiye\'nin lider B2B Cloud ERP platformunu geliştiren küçük ve hızlı hareket eden bir ekiptir. 200+ aktif müşteriye hizmet veriyoruz ve büyük şirketlerin bürokrasisi olmadan gerçek sorunları çözmeyi seviyoruz. Ekibimiz uzaktan çalışmaya açıktır; önemli olan nerede oturduğunuz değil, ne ürettiğinizdir.'
              : 'CETPA is a small, fast-moving, Antalya-based team building Turkey\'s leading B2B Cloud ERP platform. We serve 200+ active customers and enjoy solving real problems without the bureaucracy of a large company. Our team is remote-friendly — what matters is what you build, not where you sit.'}
          </p>
        </div>

        <div className="mb-14">
          <h2 className="text-lg font-bold mb-5">{isTR ? 'Değerlerimiz' : 'Our Values'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {values.map((value, i) => {
              const Icon = value.icon;
              return (
                <div key={i} className={`rounded-2xl p-6 ${card}`}>
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ backgroundColor: 'rgba(255,64,0,0.12)' }}
                  >
                    <Icon className="w-5 h-5" style={{ color: '#ff4000' }} />
                  </div>
                  <h3 className="text-base font-bold mb-2">{value.title}</h3>
                  <p className={`text-sm leading-relaxed ${muted}`}>{value.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-14">
          <h2 className="text-lg font-bold mb-5">{isTR ? 'Açık Pozisyonlar' : 'Open Positions'}</h2>
          <div className="space-y-4">
            {positions.map((position, i) => (
              <div key={i} className={`rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${card}`}>
                <div>
                  <h3 className="text-base font-bold mb-2">{position.title}</h3>
                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${muted}`}>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      {position.location}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {position.type}
                    </span>
                  </div>
                </div>
                <a
                  href={applyHref(position.title)}
                  className="inline-flex items-center justify-center gap-2 text-sm font-medium rounded-full px-5 py-2.5 transition-opacity hover:opacity-90 whitespace-nowrap"
                  style={{ backgroundColor: '#ff4000', color: '#fff' }}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {isTR ? 'Başvur' : 'Apply'}
                </a>
              </div>
            ))}
          </div>
        </div>

        <div className={`rounded-2xl p-6 text-center ${card}`}>
          <h3 className="text-base font-bold mb-2">
            {isTR ? 'Aradığınız pozisyonu bulamadınız mı?' : 'Didn\'t find the right role?'}
          </h3>
          <p className={`text-sm leading-relaxed mb-4 ${muted}`}>
            {isTR
              ? 'Size uygun bir açık pozisyon olmasa bile, genel başvurunuzu bize gönderebilirsiniz. Ekibimiz büyüdükçe özgeçmişinizi değerlendireceğiz.'
              : 'Even if there is no open role that fits right now, feel free to send us a general application. We\'ll consider your CV as our team grows.'}
          </p>
          <a
            href={generalApplyHref}
            className={`inline-flex items-center gap-2 text-sm font-medium transition-colors outline-none ${darkMode ? 'text-white/80 hover:text-white' : 'text-black/80 hover:text-black'}`}
          >
            <Mail className="w-4 h-4" style={{ color: '#ff4000' }} />
            info@cetpa.com.tr
          </a>
        </div>

        <div className={`mt-12 pt-8 border-t ${border} text-center`}>
          <p className={`text-xs ${muted}`}>© 2026 CETPA A.Ş. {isTR ? 'Tüm hakları saklıdır.' : 'All rights reserved.'}</p>
        </div>
      </main>
    </div>
  );
}
