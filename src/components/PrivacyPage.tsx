import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

interface Props {
  currentLanguage: 'tr' | 'en';
  darkMode: boolean;
  onBack: () => void;
}

export default function PrivacyPage({ currentLanguage: lang, darkMode, onBack }: Props) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const isTR = lang === 'tr';
  const bg = darkMode ? 'bg-[#0a0a0a] text-[#f5f5f7]' : 'bg-white text-[#1D1D1F]';
  const muted = darkMode ? 'text-white/40' : 'text-black/40';
  const border = darkMode ? 'border-white/8' : 'border-black/8';
  const card = darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-100';

  const sections = isTR ? [
    {
      title: '1. Giriş',
      content: 'CETPA Technology olarak gizliliğinizi ciddiye alıyoruz. Bu Gizlilik Politikası, CETPA Cloud ERP platformunu kullanırken topladığımız, işlediğimiz ve sakladığımız kişisel verileri kapsamaktadır. 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusu sıfatıyla hareket etmekteyiz.'
    },
    {
      title: '2. Toplanan Veriler',
      content: 'Hesap bilgileri (ad, e-posta, şirket adı, telefon numarası), kullanım verileri (oturum süreleri, sayfa görüntülemeleri, özellik kullanımı), ödeme bilgileri (fatura adresi; kart numaraları ödeme işlemcisi tarafından şifreli olarak saklanır), iş verileri (müşteri kayıtları, stok bilgileri, sipariş geçmişi, faturalar) ve teknik veriler (IP adresi, tarayıcı türü, cihaz bilgisi) toplanmaktadır.'
    },
    {
      title: '3. Verilerin Kullanımı',
      content: 'Toplanan veriler; hizmet sunumu ve sürdürülmesi, hesap yönetimi ve kimlik doğrulama, müşteri desteği sağlanması, platform güvenliği ve hile önleme, ürün geliştirme ve iyileştirme ile yasal yükümlülüklerin yerine getirilmesi amacıyla kullanılmaktadır. Verileriniz hiçbir zaman reklam amaçlı üçüncü taraflarla paylaşılmamaktadır.'
    },
    {
      title: '4. Veri Güvenliği',
      content: 'Verileriniz Google Firebase altyapısında, AES-256 şifreleme ile güvence altına alınmış sunucularda saklanmaktadır. Tüm veri iletimi TLS 1.3 protokolüyle şifrelenmektedir. Düzenli güvenlik denetimleri ve penetrasyon testleri uygulanmaktadır. İhlal durumunda KVKK kapsamında 72 saat içinde ilgili mercilere ve etkilenen kullanıcılara bildirim yapılacaktır.'
    },
    {
      title: '5. Üçüncü Taraf Entegrasyonları',
      content: 'CETPA; Firebase (Google LLC – veri depolama ve kimlik doğrulama), Shopify (e-ticaret entegrasyonu), Luca (e-Fatura/GİB entegrasyonu) ve Mikro ERP (muhasebe senkronizasyonu) ile entegre çalışmaktadır. Bu entegrasyonlar aracılığıyla iletilen veriler yalnızca belirtilen hizmetin sunulması amacıyla kullanılır ve her entegrasyon partneri kendi gizlilik politikasına tabidir.'
    },
    {
      title: '6. KVKK Kapsamında Haklarınız',
      content: 'Kişisel Verilerin Korunması Kanunu\'nun 11. maddesi uyarınca; kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, yurt içinde veya yurt dışında verilerin aktarıldığı üçüncü kişileri bilme, verilerin eksik veya yanlış işlenmişse düzeltilmesini isteme, silinmesini veya yok edilmesini talep etme, otomatik sistemler aracılığıyla aleyhinize bir sonucun ortaya çıkmasına itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz.'
    },
    {
      title: '7. İletişim',
      content: 'Gizlilik politikamız hakkındaki sorularınız veya veri talepleriniz için: E-posta: privacy@cetpa.io | Adres: CETPA Technology, Levent, Beşiktaş, İstanbul 34330 | Talep yanıt süresi: 30 gün içinde.'
    }
  ] : [
    {
      title: '1. Introduction',
      content: 'At CETPA Technology, we take your privacy seriously. This Privacy Policy covers the personal data we collect, process and store when you use the CETPA Cloud ERP platform. We act as a data controller under the General Data Protection Regulation (GDPR) and applicable data protection laws.'
    },
    {
      title: '2. Data We Collect',
      content: 'Account information (name, email, company name, phone number), usage data (session durations, page views, feature usage), payment information (billing address; card numbers are stored encrypted by our payment processor), business data (customer records, inventory, order history, invoices), and technical data (IP address, browser type, device information).'
    },
    {
      title: '3. How We Use Your Data',
      content: 'Collected data is used for: service delivery and maintenance, account management and authentication, customer support, platform security and fraud prevention, product development and improvement, and fulfilling legal obligations. Your data is never shared with third parties for advertising purposes.'
    },
    {
      title: '4. Data Security',
      content: 'Your data is stored on Google Firebase infrastructure with AES-256 encryption. All data transmission is encrypted with TLS 1.3. Regular security audits and penetration tests are performed. In the event of a breach, notification will be made to relevant authorities and affected users within 72 hours under GDPR Article 33.'
    },
    {
      title: '5. Third-Party Integrations',
      content: 'CETPA integrates with Firebase (Google LLC – data storage and authentication), Shopify (e-commerce integration), Luca (e-Invoice/tax authority integration), and Mikro ERP (accounting synchronisation). Data transmitted through these integrations is used solely for the stated service purpose, and each integration partner is subject to its own privacy policy.'
    },
    {
      title: '6. Your Rights (GDPR)',
      content: 'Under GDPR, you have the right to: access your personal data, rectify inaccurate data, erase your data ("right to be forgotten"), restrict processing, data portability, object to processing, and withdraw consent at any time. To exercise any of these rights, contact us at privacy@cetpa.io. We will respond within 30 days.'
    },
    {
      title: '7. Contact',
      content: 'For questions about this policy or data requests: Email: privacy@cetpa.io | Address: CETPA Technology, Levent, Beşiktaş, Istanbul 34330, Turkey | Response time: within 30 days.'
    }
  ];

  return (
    <div className={`min-h-screen ${bg}`}>
      {/* Sticky header */}
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
          <span className={`text-sm font-medium ${muted}`}>{isTR ? 'Gizlilik Politikası' : 'Privacy Policy'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${muted}`}>{isTR ? 'Son Güncelleme' : 'Last Updated'}: 16 {isTR ? 'Nisan' : 'April'} 2026</p>
          <h1 className="text-4xl font-bold mb-4">{isTR ? 'Gizlilik Politikası' : 'Privacy Policy'}</h1>
          <p className={muted}>{isTR ? 'CETPA Technology olarak kişisel verilerinizin güvenliğini ön planda tutuyoruz.' : 'At CETPA Technology, the security of your personal data is our top priority.'}</p>
        </div>

        <div className="space-y-8">
          {sections.map((section, i) => (
            <div key={i} className={`rounded-2xl p-6 ${card}`}>
              <h2 className="text-lg font-bold mb-3">{section.title}</h2>
              <p className={`text-sm leading-relaxed ${muted}`}>{section.content}</p>
            </div>
          ))}
        </div>

        <div className={`mt-12 pt-8 border-t ${border} text-center`}>
          <p className={`text-xs ${muted}`}>© 2026 CETPA Technology. {isTR ? 'Tüm hakları saklıdır.' : 'All rights reserved.'}</p>
        </div>
      </main>
    </div>
  );
}
