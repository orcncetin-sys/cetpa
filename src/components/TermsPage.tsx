import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

interface Props {
  currentLanguage: 'tr' | 'en';
  darkMode: boolean;
  onBack: () => void;
}

export default function TermsPage({ currentLanguage: lang, darkMode, onBack }: Props) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const isTR = lang === 'tr';
  const bg = darkMode ? 'bg-[#0a0a0a] text-[#f5f5f7]' : 'bg-white text-[#1D1D1F]';
  const muted = darkMode ? 'text-white/40' : 'text-black/40';
  const border = darkMode ? 'border-white/8' : 'border-black/8';
  const card = darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-100';

  const sections = isTR ? [
    { title: '1. Hizmet Tanımı', content: 'CETPA Cloud ERP, satış, lojistik, üretim, muhasebe ve insan kaynakları süreçlerini tek bir dijital platformda toplayan bulut tabanlı bir kurumsal kaynak planlama yazılımıdır. Hizmet; web arayüzü, API erişimi ve üçüncü taraf entegrasyonlarını kapsamaktadır.' },
    { title: '2. Hesap ve Güvenlik', content: 'Kullanıcı hesabınızın güvenliğinden siz sorumlusunuz. Güçlü parola kullanımı ve çok faktörlü kimlik doğrulama önerilir. Hesabınızın yetkisiz kullanımını derhal bildirmeniz gerekmektedir. CETPA, ihmal veya kasıttan kaynaklanmayan yetkisiz erişimlerden sorumlu tutulamaz.' },
    { title: '3. Ödeme Koşulları', content: 'Abonelik ücretleri seçilen plan dönemine (aylık veya yıllık) göre peşin tahsil edilir. Ödemeler otomatik yenilenir; iptal 30 gün önceden bildirilmelidir. Yıllık planlar aylık planlara kıyasla indirim sunar. Vergiler varsa ayrıca faturalandırılır. İade politikası: İlk 14 gün içinde iptal halinde tam iade yapılır.' },
    { title: '4. Kabul Edilemez Kullanım', content: 'Platformu yasa dışı amaçlarla kullanmak, başka kullanıcıların hesaplarına yetkisiz erişim sağlamak, sisteme zarar verecek kod veya zararlı yazılım yüklemek, hizmetin kullanılabilirliğini bozmak, CETPA\'nın fikri mülkiyet haklarını ihlal etmek kesinlikle yasaktır. Bu tür ihlaller hesabın derhal askıya alınmasına yol açar.' },
    { title: '5. Fikri Mülkiyet', content: 'CETPA Cloud ERP yazılımı, arayüz tasarımı, logolar ve içerikler CETPA Technology\'nin münhasır mülkiyetindedir ve telif hukuku ile diğer fikri mülkiyet yasalarıyla korunmaktadır. Kullanıcılara yalnızca sınırlı, devredilemez ve kişisel kullanım lisansı tanınır. Lisans kapsamı dışında kopyalama, dağıtım veya türev çalışma oluşturmak yasaktır.' },
    { title: '6. Sorumluluk Sınırı', content: 'CETPA; dolaylı, arızi, özel veya sonuç olarak ortaya çıkan zararlardan sorumlu tutulamaz. Doğrudan zarar sorumluluğu, ilgili dönemde ödenen abonelik ücretini aşamaz. Hizmet kesintileri veya veri kayıpları için azami çaba sarf edilir ancak %100 uptime garantisi verilmez.' },
    { title: '7. Fesih', content: 'Kullanıcı hesabını istediği zaman kapatabilir. CETPA, bu koşulların ihlali durumunda önceden bildirmeksizin hesabı askıya alabilir veya silebilir. Fesih halinde verileriniz 90 gün süreyle saklanır ve bu süre içinde talep edildiğinde dışa aktarılabilir.' },
    { title: '8. Uygulanacak Hukuk', content: 'Bu sözleşme Türkiye Cumhuriyeti hukukuna tabidir. Anlaşmazlıklar önce arabuluculuk yoluyla çözülmeye çalışılır; çözüme kavuşturulamazsa İstanbul Mahkemeleri ve İcra Daireleri yetkilidir.' }
  ] : [
    { title: '1. Service Description', content: 'CETPA Cloud ERP is a cloud-based enterprise resource planning software that consolidates sales, logistics, production, accounting and human resources processes on a single digital platform. The service includes web interface, API access and third-party integrations.' },
    { title: '2. Account & Security', content: 'You are responsible for the security of your user account. Strong passwords and multi-factor authentication are recommended. You must immediately report any unauthorised use of your account. CETPA cannot be held liable for unauthorised access not resulting from its own negligence or misconduct.' },
    { title: '3. Payment Terms', content: 'Subscription fees are collected in advance according to the selected plan period (monthly or annual). Payments auto-renew; cancellation must be notified 30 days in advance. Annual plans offer a discount compared to monthly plans. Taxes, if applicable, are invoiced separately. Refund policy: full refund if cancelled within the first 14 days.' },
    { title: '4. Acceptable Use', content: 'Using the platform for illegal purposes, gaining unauthorised access to other users\' accounts, uploading code or malware that would harm the system, disrupting service availability, and infringing CETPA\'s intellectual property rights are strictly prohibited. Such violations result in immediate account suspension.' },
    { title: '5. Intellectual Property', content: 'CETPA Cloud ERP software, interface design, logos and content are the exclusive property of CETPA Technology and are protected by copyright and other intellectual property laws. Users are granted only a limited, non-transferable personal use licence. Copying, distributing or creating derivative works outside the licence scope is prohibited.' },
    { title: '6. Limitation of Liability', content: 'CETPA shall not be liable for indirect, incidental, special or consequential damages. Direct damage liability shall not exceed the subscription fee paid in the relevant period. Maximum effort is made to prevent service interruptions or data loss, but 100% uptime is not guaranteed.' },
    { title: '7. Termination', content: 'Users may close their accounts at any time. CETPA may suspend or delete accounts without prior notice in case of breach of these terms. Upon termination, your data will be retained for 90 days and can be exported on request during this period.' },
    { title: '8. Governing Law', content: 'This agreement is governed by the laws of the Republic of Turkey. Disputes will first be attempted to be resolved through mediation; if unresolved, Istanbul Courts and Enforcement Offices shall have jurisdiction.' }
  ];

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
          <span className={`text-sm font-medium ${muted}`}>{isTR ? 'Kullanım Koşulları' : 'Terms of Service'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${muted}`}>{isTR ? 'Son Güncelleme' : 'Last Updated'}: 16 {isTR ? 'Nisan' : 'April'} 2026</p>
          <h1 className="text-4xl font-bold mb-4">{isTR ? 'Kullanım Koşulları' : 'Terms of Service'}</h1>
          <p className={muted}>{isTR ? 'CETPA platformunu kullanmadan önce lütfen bu koşulları dikkatlice okuyunuz.' : 'Please read these terms carefully before using the CETPA platform.'}</p>
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
