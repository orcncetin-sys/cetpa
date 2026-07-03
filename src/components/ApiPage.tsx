import { useEffect } from 'react';
import {
  ArrowLeft,
  Database,
  Building2,
  Cloud,
  Factory,
  Calculator,
  FileText,
  ShoppingCart,
  Store,
  CreditCard,
  Truck,
  Webhook,
  Code2,
  Link2,
  Send,
} from 'lucide-react';

interface Props {
  currentLanguage: 'tr' | 'en';
  darkMode: boolean;
  onBack: () => void;
}

export default function ApiPage({ currentLanguage: lang, darkMode, onBack }: Props) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const isTR = lang === 'tr';
  const bg = darkMode ? 'bg-[#0a0a0a] text-[#f5f5f7]' : 'bg-white text-[#1D1D1F]';
  const muted = darkMode ? 'text-white/40' : 'text-black/40';
  const border = darkMode ? 'border-white/8' : 'border-black/8';
  const card = darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-100';
  const codeBg = darkMode ? 'bg-black/60 border border-white/10' : 'bg-[#1D1D1F] border border-black/10';

  const integrations = [
    {
      icon: Database,
      name: 'Mikro ERP',
      desc: isTR ? 'Stok, cari ve fatura verilerini gerçek zamanlı senkronize eder.' : 'Syncs stock, customer and invoice data in real time.',
    },
    {
      icon: Building2,
      name: 'Logo',
      desc: isTR ? 'Logo ERP muhasebe ve stok modülleriyle çift yönlü entegrasyon.' : 'Two-way integration with Logo ERP accounting and inventory modules.',
    },
    {
      icon: Cloud,
      name: 'SAP',
      desc: isTR ? 'Kurumsal SAP altyapısına özel bağlantı desteği.' : 'Dedicated connectivity support for enterprise SAP infrastructure.',
    },
    {
      icon: Factory,
      name: 'Microsoft Dynamics',
      desc: isTR ? 'Dynamics ile satış ve envanter verisi eşitleme.' : 'Sales and inventory data alignment with Dynamics.',
    },
    {
      icon: Calculator,
      name: 'Paraşüt',
      desc: isTR ? 'Fiyat listeleri ve bakiye bilgilerini otomatik çeker.' : 'Automatically pulls price lists and balance information.',
    },
    {
      icon: FileText,
      name: 'Luca (GİB e-Fatura/e-Defter)',
      desc: isTR ? 'GİB uyumlu e-fatura ve e-defter süreçlerini bağlar.' : 'Connects GİB-compliant e-invoice and e-ledger processes.',
    },
    {
      icon: ShoppingCart,
      name: 'Shopify',
      desc: isTR ? 'Sipariş ve stok akışını e-ticaret mağazanızla eşler.' : 'Mirrors order and stock flow with your e-commerce store.',
    },
    {
      icon: Store,
      name: 'Hepsiburada',
      desc: isTR ? 'Pazaryeri sipariş ve stok bildirimlerini merkezileştirir.' : 'Centralises marketplace order and stock notifications.',
    },
    {
      icon: CreditCard,
      name: 'İyzico',
      desc: isTR ? 'Ödeme tahsilat ve mutabakat verilerini entegre eder.' : 'Integrates payment collection and reconciliation data.',
    },
    {
      icon: Truck,
      name: isTR ? 'Kargo Firmaları' : 'Cargo Carriers',
      desc: isTR ? 'Aras, DHL, MNG, PTT, UPS ve Yurtiçi Kargo takibi tek ekranda.' : 'Aras, DHL, MNG, PTT, UPS and Yurtiçi Kargo tracking in one screen.',
    },
  ];

  const capabilities = isTR ? [
    { title: 'Webhook Desteği', text: 'Sipariş oluşturma, stok seviyesi değişimi, fatura durumu ve kargo takip olayları için webhook bildirimleri tanımlanabilir.' },
    { title: 'Özel REST Erişimi', text: 'Kurumsal ihtiyaçlara göre şekillendirilmiş REST uç noktaları ile envanter, cari ve sipariş verilerine programatik erişim sağlanır.' },
    { title: 'Kurulum ve Destek', text: 'Entegrasyon kapsamı, kimlik doğrulama yöntemi ve veri alanları CETPA ekibiyle birlikte özel olarak tasarlanır ve devreye alınır.' },
  ] : [
    { title: 'Webhook Support', text: 'Webhook notifications can be configured for order creation, stock level changes, invoice status and shipment tracking events.' },
    { title: 'Custom REST Access', text: 'Programmatic access to inventory, customer and order data through REST endpoints tailored to enterprise requirements.' },
    { title: 'Setup & Support', text: 'Integration scope, authentication method and data fields are custom-designed and rolled out together with the CETPA team.' },
  ];

  const codeExample = `POST /webhooks/stock-updated
Content-Type: application/json
X-Cetpa-Signature: sha256=...

{
  "event": "stock.updated",
  "tenantId": "cetpa_tr_0483",
  "timestamp": "2026-07-02T09:14:22Z",
  "data": {
    "sku": "CTP-2048-BLK",
    "productName": "Endüstriyel Konnektör Seti",
    "warehouse": "Antalya Merkez Depo",
    "previousQuantity": 128,
    "newQuantity": 96,
    "unit": "adet",
    "source": "mikro_erp_sync"
  }
}`;

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
          <span className={`text-sm font-medium ${muted}`}>{isTR ? 'API ve Entegrasyonlar' : 'API & Integrations'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${muted}`}>
            {isTR ? "Türkiye'nin Lider B2B Cloud ERP Platformu" : "Turkey's Leading B2B Cloud ERP Platform"}
          </p>
          <h1 className="text-4xl font-bold mb-4">{isTR ? 'API ve Entegrasyonlar' : 'API & Integrations'}</h1>
          <p className={`leading-relaxed ${muted}`}>
            {isTR
              ? 'CETPA, işletmenizi mevcut araçlarınızdan koparmaz; onlarla konuşur. Amacımız köklü sistemlerinizi baştan değiştirmenizi istemek değil, Mikro, Logo, SAP veya Dynamics gibi zaten kullandığınız ERP altyapılarıyla, muhasebe programlarınızla ve pazaryeri hesaplarınızla CETPA arasında güvenilir bir köprü kurmaktır. 200+ aktif müşteri, verilerini bu şekilde kesintisiz akıtıyor.'
              : "CETPA doesn't rip your business away from the tools you already use — it talks to them. Our goal isn't to force a wholesale replacement of your established systems, but to build a reliable bridge between CETPA and the ERP infrastructure, accounting software and marketplace accounts you already run, whether that's Mikro, Logo, SAP or Dynamics. 200+ active customers keep their data flowing this way, without interruption."}
          </p>
        </div>

        <div className="mb-12">
          <h2 className="text-lg font-bold mb-4">{isTR ? 'Desteklenen Entegrasyonlar' : 'Supported Integrations'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {integrations.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className={`rounded-2xl p-5 flex gap-4 ${card}`}>
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'rgba(255,64,0,0.12)' }}
                  >
                    <Icon className="w-5 h-5" style={{ color: '#ff4000' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold mb-1">{item.name}</h3>
                    <p className={`text-xs leading-relaxed ${muted}`}>{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Webhook className="w-5 h-5" style={{ color: '#ff4000' }} />
            <h2 className="text-lg font-bold">{isTR ? 'REST API ve Webhook\'lar' : 'REST API & Webhooks'}</h2>
          </div>
          <p className={`text-sm leading-relaxed mb-6 ${muted}`}>
            {isTR
              ? 'CETPA, self-servis bir geliştirici portalı yerine, Enterprise plan kapsamında özel olarak kurulan bir entegrasyon erişimi sunar. Aşağıdaki yetenekler, "Özel API Entegrasyonları" hizmeti kapsamında ekibimizle birlikte tanımlanır ve devreye alınır.'
              : 'Instead of a self-serve developer portal, CETPA offers integration access that is custom-provisioned as part of the Enterprise plan. The capabilities below are scoped and rolled out together with our team as part of the "Custom API Integrations" service.'}
          </p>
          <div className="space-y-4">
            {capabilities.map((cap, i) => (
              <div key={i} className={`rounded-2xl p-6 ${card}`}>
                <h3 className="text-sm font-bold mb-2">{cap.title}</h3>
                <p className={`text-sm leading-relaxed ${muted}`}>{cap.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-5 h-5" style={{ color: '#ff4000' }} />
            <h2 className="text-lg font-bold">{isTR ? 'Örnek Webhook Verisi' : 'Example Webhook Payload'}</h2>
          </div>
          <p className={`text-sm leading-relaxed mb-4 ${muted}`}>
            {isTR
              ? 'Stok seviyesi bir ERP senkronizasyonu sonucunda değiştiğinde sisteminize gönderilebilecek örnek bir webhook isteği aşağıdadır. Alan adları ve yapı, gerçek kurulum sırasında ihtiyacınıza göre uyarlanır.'
              : 'Below is an illustrative webhook request that could be sent to your system when a stock level changes as a result of an ERP sync. Field names and structure are adapted to your needs during actual setup.'}
          </p>
          <pre className={`rounded-2xl p-5 overflow-x-auto text-xs leading-relaxed ${codeBg}`}>
            <code className="text-[#f5f5f7]">{codeExample}</code>
          </pre>
        </div>

        <div className={`rounded-2xl p-8 text-center ${card}`}>
          <Link2 className="w-8 h-8 mx-auto mb-4" style={{ color: '#ff4000' }} />
          <h2 className="text-xl font-bold mb-2">{isTR ? 'Entegrasyon İhtiyacınızı Konuşalım' : "Let's Talk About Your Integration Needs"}</h2>
          <p className={`text-sm leading-relaxed mb-6 max-w-md mx-auto ${muted}`}>
            {isTR
              ? 'Mevcut sistemlerinizi CETPA ile bağlamak için ekibimizle iletişime geçin; kurulum kapsamını birlikte belirleyelim.'
              : 'Get in touch with our team to connect your existing systems to CETPA — we will scope the setup together.'}
          </p>
          <a
            href="mailto:info@cetpa.com.tr?subject=API%20Eri%C5%9Fimi"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#ff4000' }}
          >
            <Send className="w-4 h-4" />
            {isTR ? 'Talep Gönder' : 'Request Access'}
          </a>
        </div>

        <div className={`mt-12 pt-8 border-t ${border} text-center`}>
          <p className={`text-xs ${muted}`}>© 2026 CETPA Technology. {isTR ? 'Tüm hakları saklıdır.' : 'All rights reserved.'}</p>
        </div>
      </main>
    </div>
  );
}
