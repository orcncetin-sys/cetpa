/**
 * ReportsDashboard.tsx — Analitik & raporlama ekranı (kabuk)
 *
 * 2026-07-30'a kadar 16.101 satırdı — kod tabanının en büyük dosyası. Altı
 * sekmenin 332 render bloğu dosya boyunca iç içe dağılmıştı; hepsi tek bir
 * hesaplama kapsamını paylaşıyordu. Bölüm:
 *   useReportsData.ts   paylaşılan state/memo/effect (tip otomatik türer)
 *   reports/*Rapor.tsx  sekme başına bloklar, içerik DEĞİŞTİRİLMEDEN taşındı
 * Bu dosyada yalnız başlık, sekme çubuğu ve lazy yönlendirme kaldı.
 *
 * Sekmeler React.lazy ile yüklenir: Raporlar açıldığında yalnız aktif sekmenin
 * paketi iner, altısı birden değil.
 *
 * Saf görüntüleme bileşeni — veritabanına yazma yok.
 */
import React, { Suspense } from 'react';
import { LayoutDashboard, List, Truck, UserCheck, Package, Users, BarChart3, Download } from 'lucide-react';
import ModuleHeader from './ModuleHeader';
import { useReportsData, type ReportsProps } from './reports/useReportsData';

const GenelRapor    = React.lazy(() => import('./reports/GenelRapor'));
const CrmRapor      = React.lazy(() => import('./reports/CrmRapor'));
const EnvanterRapor = React.lazy(() => import('./reports/EnvanterRapor'));
const LojistikRapor = React.lazy(() => import('./reports/LojistikRapor'));
const IKRapor       = React.lazy(() => import('./reports/IKRapor'));
const UrunlerRapor  = React.lazy(() => import('./reports/UrunlerRapor'));

const LAZY_FALLBACK = (
  <div className="apple-card p-8 flex items-center justify-center text-sm text-[#86868B]">
    Yükleniyor…
  </div>
);

const ReportsDashboard = (props: ReportsProps) => {
  const ctx = useReportsData(props);
  const { currentT, currentLanguage, reportsTab, setReportsTab, timeRange, setTimeRange, exportPDF } = ctx;

  // Sekme çubuğu yapılandırması — saf UI, hesaplama katmanına ait değil.
  const subTabs = [
    { id: 'genel', label: currentLanguage==='tr'?'Genel Bakış':'Overview', icon: LayoutDashboard },
    { id: 'crm', label: currentLanguage==='tr'?'CRM & Satış':'CRM & Sales', icon: Users },
    { id: 'envanter', label: currentLanguage==='tr'?'Envanter':'Inventory', icon: List },
    { id: 'lojistik', label: currentLanguage==='tr'?'Lojistik':'Logistics', icon: Truck },
    { id: 'ik', label: currentLanguage==='tr'?'İnsan Kaynakları':'Human Resources', icon: UserCheck },
    { id: 'urunler', label: currentLanguage==='tr'?'Ürün Performansı':'Product Performance', icon: Package },
  ] as const;

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={currentT.reports}
        subtitle={currentT.reports_dashboard_desc}
        icon={BarChart3}
        actionButton={
          <div className="flex gap-3">
            <button onClick={exportPDF} className="apple-button-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> {currentT.export_pdf}
            </button>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="apple-input text-sm font-semibold">
              <option value="7">{currentT.last_7_days}</option>
              <option value="30">{currentT.last_30_days}</option>
              <option value="90">{currentT.last_90_days}</option>
            </select>
          </div>
        }
      />

      {/* Sub-tab Navigation */}
      <div className="overflow-x-auto scrollbar-none">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setReportsTab(tab.id)}
                className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${reportsTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                <Icon size={13} />{tab.label}
              </button>
            );
          })}
        </div>
      </div>


      <Suspense fallback={LAZY_FALLBACK}>
        {reportsTab === 'genel'    && <GenelRapor    {...ctx} />}
        {reportsTab === 'crm'      && <CrmRapor      {...ctx} />}
        {reportsTab === 'envanter' && <EnvanterRapor {...ctx} />}
        {reportsTab === 'lojistik' && <LojistikRapor {...ctx} />}
        {reportsTab === 'ik'       && <IKRapor       {...ctx} />}
        {reportsTab === 'urunler'  && <UrunlerRapor  {...ctx} />}
      </Suspense>

    </div>
  );
};

export default ReportsDashboard;
