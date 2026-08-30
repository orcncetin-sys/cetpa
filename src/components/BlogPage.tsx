import { useEffect } from 'react';
import { ArrowLeft, Clock, Mail, Sparkles } from 'lucide-react';

interface Props {
  currentLanguage: 'tr' | 'en';
  darkMode: boolean;
  onBack: () => void;
}

export default function BlogPage({ currentLanguage: lang, darkMode, onBack }: Props) {
  useEffect(() => {
    window.scrollTo(0, 0);
    // Sekme basligi — SPA'da genel sayfalar kendi basligini koymuyordu; tum
    // sayfalar "CETPA Cloud ERP — ..." gorunuyordu (a11y teshisi 2026-08-28).
    const onceki = document.title;
    document.title = (lang === 'tr' ? 'Blog' : 'Blog') + ' — CETPA';
    return () => { document.title = onceki; };
  }, [lang]);
  const isTR = lang === 'tr';
  const bg = darkMode ? 'bg-[#0a0a0a] text-[#f5f5f7]' : 'bg-white text-[#1D1D1F]';
  const muted = darkMode ? 'text-white/65' : 'text-black/70';
  const border = darkMode ? 'border-white/8' : 'border-black/8';
  const card = darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-100';
  const tagBg = darkMode ? 'bg-white/10 text-white/70' : 'bg-black/5 text-black/60';

  const posts = isTR ? [
    {
      category: 'Envanter',
      title: 'Stok Yönetiminde Sık Yapılan 7 Hata ve Çözümleri',
      excerpt: 'Fazla stok, stoksuz kalma ve manuel sayım hataları KOBİ\'lerin en çok karşılaştığı sorunlardır. Doğru envanter süreçleriyle bu maliyetleri nasıl azaltabileceğinizi ele alıyoruz.'
    },
    {
      category: 'ERP',
      title: 'Mikro, Logo ve SAP Arasında Seçim Yaparken Dikkat Edilmesi Gerekenler',
      excerpt: 'Her ERP altyapısının güçlü ve zayıf yönleri farklıdır. İşletme büyüklüğüne, sektöre ve entegrasyon ihtiyaçlarına göre doğru platformu seçmek için pratik bir karşılaştırma çerçevesi.'
    },
    {
      category: 'E-ticaret',
      title: 'B2B Fiyatlandırmada Katman Stratejisi: Perakende, Standart, Premium ve Bayi',
      excerpt: 'Aynı ürüne farklı müşteri segmentlerinde farklı fiyat uygulamak, hem kâr marjını korumak hem de bayi ilişkilerini güçlendirmek için etkili bir yöntemdir. Katmanlı fiyatlandırma nasıl kurgulanır?'
    },
    {
      category: 'Muhasebe',
      title: 'E-Fatura Uyumluluğunda Nelere Dikkat Etmeli?',
      excerpt: 'GİB entegrasyonlarında sık karşılaşılan uyumsuzluklar ve bunları önlemenin yolları. Otomatik senkronizasyonun manuel süreçlere kıyasla sağladığı zaman ve hata avantajı.'
    },
    {
      category: 'Lojistik',
      title: 'Çoklu Depo Yönetiminde Verimliliği Artıran 5 Prensip',
      excerpt: 'Birden fazla depo ile çalışan işletmelerde sevkiyat gecikmeleri ve stok tutarsızlıkları büyür. Depolar arası görünürlük ve merkezi takip ile bu riskler nasıl azaltılır?'
    },
    {
      category: 'Dijital Dönüşüm',
      title: 'KOBİ\'ler İçin Dijital Dönüşüme Nereden Başlamalı?',
      excerpt: 'Kağıt tabanlı süreçlerden bulut tabanlı bir sisteme geçiş, doğru planlandığında sanılandan çok daha az sancılı olabilir. Adım adım bir yol haritası.'
    }
  ] : [
    {
      category: 'Inventory',
      title: '7 Common Inventory Management Mistakes and How to Fix Them',
      excerpt: 'Overstocking, stockouts and manual counting errors are among the most frequent problems SMEs face. We look at how the right inventory processes can reduce these costs.'
    },
    {
      category: 'ERP',
      title: 'Choosing Between Mikro, Logo and SAP: What Actually Matters',
      excerpt: 'Every ERP backbone has different strengths and trade-offs. A practical comparison framework for picking the right platform based on company size, industry and integration needs.'
    },
    {
      category: 'E-commerce',
      title: 'Tiered B2B Pricing: Retail, Standard, Premium and Dealer Explained',
      excerpt: 'Applying different prices for the same product across customer segments is an effective way to protect margins and strengthen dealer relationships. How to structure tiered pricing.'
    },
    {
      category: 'Accounting',
      title: 'What to Watch for in E-Invoice Compliance in Turkey',
      excerpt: 'Common mismatches in tax authority (GİB) e-invoice integrations and how to avoid them. The time and error advantage of automated synchronisation over manual processes.'
    },
    {
      category: 'Logistics',
      title: '5 Principles for More Efficient Multi-Warehouse Operations',
      excerpt: 'Businesses running multiple warehouses often see shipping delays and stock inconsistencies grow. How cross-warehouse visibility and centralised tracking reduce these risks.'
    },
    {
      category: 'Digital Transformation',
      title: 'Where Should SMEs Start Their Digital Transformation?',
      excerpt: 'Moving from paper-based processes to a cloud-based system can be far less painful than expected when properly planned. A step-by-step roadmap.'
    }
  ];

  return (
    <div className={`min-h-screen ${bg}`}>
      <header className={`sticky top-0 z-50 border-b ${border} backdrop-blur-xl ${darkMode ? 'bg-[#0a0a0a]/80' : 'bg-white/80'}`}>
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-4">
          <button
            onClick={onBack}
            className={`flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-lg py-2.5 -my-2.5 ${darkMode ? 'text-white/60 hover:text-white' : 'text-black/60 hover:text-black'}`}
          >
            <ArrowLeft className="w-4 h-4" />
            {isTR ? 'Geri' : 'Back'}
          </button>
          <div className="w-px h-4 bg-current opacity-20" />
          <span className="text-sm font-bold" style={{ color: '#ff4000' }}>CETPA</span>
          <span className={`text-sm font-medium ${muted}`}>{isTR ? 'Blog' : 'Blog'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-4">{isTR ? 'CETPA Blog' : 'CETPA Blog'}</h1>
          <p className={muted}>
            {isTR
              ? 'B2B ERP, dijital dönüşüm, lojistik ve muhasebe üzerine Türkiye\'deki KOBİ\'lere yönelik içgörüler. Ekibimiz sahadan öğrendiklerini burada paylaşmaya hazırlanıyor.'
              : 'Insights on B2B ERP, digital transformation, logistics and accounting for Turkish SMEs. Our team is preparing to share what we learn from the field right here.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {posts.map((post, i) => (
            <div key={i} className={`rounded-2xl p-6 flex flex-col ${card}`}>
              <span className={`inline-block self-start text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-4 ${tagBg}`}>
                {post.category}
              </span>
              <h2 className="text-base font-bold mb-2 leading-snug">{post.title}</h2>
              <p className={`text-sm leading-relaxed mb-4 flex-1 ${muted}`}>{post.excerpt}</p>
              {/* Eskiden burada "6 dk okuma · 2 hafta önce" yazıyordu. İkisi de
                  UYDURMAYDI ve sayfanın kendi "henüz yayında değil" beyanıyla
                  çelişiyordu: yayınlanmamış bir yazının yayın tarihi ve okuma
                  süresi olamaz (2026-08-28). Yazı gerçekten yayınlanınca
                  gerçek tarih buraya konur. */}
              <div className={`flex items-center gap-2 text-xs pt-4 border-t ${border} ${muted}`}>
                <Clock className="w-3.5 h-3.5" />
                <span>{isTR ? 'Hazırlanıyor' : 'In preparation'}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`mt-12 rounded-2xl p-8 text-center ${card}`}>
          <Sparkles className="w-6 h-6 mx-auto mb-4" style={{ color: '#ff4000' }} />
          <h2 className="text-lg font-bold mb-2">
            {isTR ? 'Tam Yazılar Çok Yakında' : 'Full Articles Coming Soon'}
          </h2>
          <p className={`text-sm leading-relaxed mb-6 max-w-md mx-auto ${muted}`}>
            {isTR
              ? 'Yukarıdaki kartlar hazırlığını sürdürdüğümüz içeriklerin bir önizlemesidir; henüz okunabilir tam yazılar yayında değildir. Yayınlandıklarında haber vermemizi isterseniz bize e-posta gönderebilirsiniz.'
              : 'The cards above are a preview of content we are preparing; full, readable articles are not live yet. Subscribe to our newsletter to be notified when they publish.'}
          </p>
          <a
            href={isTR
              ? 'mailto:info@cetpa.com.tr?subject=Blog%20yay%C4%B1nlan%C4%B1nca%20haber%20ver'
              : 'mailto:info@cetpa.com.tr?subject=Notify%20me%20when%20the%20blog%20is%20live'}
            className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-full text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#ff4000' }}
          >
            <Mail className="w-4 h-4" />
            {isTR ? 'Yayınlanınca Haber Ver' : 'Notify Me When Live'}
          </a>
        </div>

        <div className={`mt-12 pt-8 border-t ${border} text-center`}>
          <p className={`text-xs ${muted}`}>© 2026 CETPA A.Ş. {isTR ? 'Tüm hakları saklıdır.' : 'All rights reserved.'}</p>
        </div>
      </main>
    </div>
  );
}
