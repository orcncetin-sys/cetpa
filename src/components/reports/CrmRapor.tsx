/**
 * CrmRapor.tsx — Raporlar > CRM & Satış sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'crm' sekmesine ait 88 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'crm'` koşulları BİLEREK korundu: ebeveyn zaten
 * sekmeye göre render ediyor, ama koşulu silmek binlerce satırda metin
 * dönüşümü demekti ve bu taşımanın "saf kopya" güvencesini bozardı.
 */
/*
 * 2026-09-03 bölme (2. tur): dosya 3.585 satırdı; kalan 80 IIFE bloğu, ORİJİNAL
 * SIRAYLA ve içeriği DEĞİŞTİRİLMEDEN, ardışık gruplar hâlinde ./crm/CrmBloklar1–10
 * bileşenlerine taşındı (GenelRapor deseni: dispatcher + çocuklar; props = tsc
 * "Cannot find name" listesi). Blok içi hiçbir state/hook yoktu. Eski
 * `void itemCostTRY; void itemPriceTRY;` satırı kaldırıldı: o yardımcıları artık
 * yalnız kullanan çocuk (CrmBloklar7) kendisi import ediyor.
 */
import { type ReportsCtx } from './useReportsData';
// 2026-08-31 mekanik bölme: en büyük 8 blok ./crm/ altına bileşen olarak çıkarıldı
// (davranış değişmedi; her bloğun render koşulu BU dosyada, ebeveynde durur).
import CrmOzetBolumu from './crm/CrmOzetBolumu';
import TeklifSiparisDonusumu from './crm/TeklifSiparisDonusumu';
import MusteriChurnAnalizi from './crm/MusteriChurnAnalizi';
import MusteriKarAnalizi from './crm/MusteriKarAnalizi';
import IskontoSizintiAnalizi from './crm/IskontoSizintiAnalizi';
import MusteriKademeTrendi from './crm/MusteriKademeTrendi';
import IlkYenidenSiparisSuresi from './crm/IlkYenidenSiparisSuresi';
import PipelineAsamaHizi from './crm/PipelineAsamaHizi';
import CrmBloklar1 from './crm/CrmBloklar1';
import CrmBloklar2 from './crm/CrmBloklar2';
import CrmBloklar3 from './crm/CrmBloklar3';
import CrmBloklar4 from './crm/CrmBloklar4';
import CrmBloklar5 from './crm/CrmBloklar5';
import CrmBloklar6 from './crm/CrmBloklar6';
import CrmBloklar7 from './crm/CrmBloklar7';
import CrmBloklar8 from './crm/CrmBloklar8';
import CrmBloklar9 from './crm/CrmBloklar9';
import CrmBloklar10 from './crm/CrmBloklar10';

export default function CrmRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, onMusteriAc, quotations, inventoryMovements, revenueCurrency, setRevenueCurrency, reportsTab, fmtAna, statusChartData, topCustomers, trendData, COLORS } = ctx;
  // `exchangeRates` kur YOKKEN null gelir; formatInCurrency imzası `?: ExchangeRates`.
  // `?? undefined` yalnız TİP köprüsü — iki değerde de fonksiyon kuru bulamayıp '—'
  // döndürür, uydurma bir kur/tutar üretmez.
  const fxKurlari = exchangeRates ?? undefined;
  return (
    <>
      {reportsTab === 'crm' && (
        <CrmOzetBolumu
          orders={orders} currentLanguage={currentLanguage} currentT={currentT}
          revenueCurrency={revenueCurrency} setRevenueCurrency={setRevenueCurrency} onMusteriAc={onMusteriAc}
          statusChartData={statusChartData} COLORS={COLORS} topCustomers={topCustomers}
          trendData={trendData} fxKurlari={fxKurlari}
        />
      )}

      <CrmBloklar1 reportsTab={reportsTab} orders={orders} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      {reportsTab === 'crm' && quotations.length > 0 && (
        <TeklifSiparisDonusumu quotations={quotations} currentLanguage={currentLanguage} fmtAna={fmtAna} />
      )}

      <CrmBloklar2 reportsTab={reportsTab} orders={orders} inventory={inventory} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      {reportsTab === 'crm' && orders.length >= 5 && (
        <MusteriChurnAnalizi orders={orders} currentLanguage={currentLanguage} fmtAna={fmtAna} />
      )}

      <CrmBloklar3 reportsTab={reportsTab} orders={orders} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      {reportsTab === 'crm' && orders.length >= 3 && inventory.length > 0 && (
        <MusteriKarAnalizi orders={orders} inventory={inventory} inventoryMovements={inventoryMovements} exchangeRates={exchangeRates} currentLanguage={currentLanguage} fmtAna={fmtAna} />
      )}

      <CrmBloklar4 reportsTab={reportsTab} orders={orders} quotations={quotations} inventory={inventory} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      {reportsTab === 'crm' && orders.length >= 5 && (
        <IskontoSizintiAnalizi orders={orders} inventory={inventory} currentLanguage={currentLanguage} fmtAna={fmtAna} />
      )}

      <CrmBloklar5 reportsTab={reportsTab} quotations={quotations} currentLanguage={currentLanguage} />

      {reportsTab === 'crm' && orders.length >= 5 && (
        <MusteriKademeTrendi orders={orders} currentLanguage={currentLanguage} fmtAna={fmtAna} />
      )}

      <CrmBloklar6 reportsTab={reportsTab} orders={orders} quotations={quotations} inventory={inventory} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      {reportsTab === 'crm' && orders.length >= 8 && (
        <IlkYenidenSiparisSuresi orders={orders} currentLanguage={currentLanguage} />
      )}

      {reportsTab === 'crm' && quotations.length >= 5 && (
        <PipelineAsamaHizi quotations={quotations} currentLanguage={currentLanguage} />
      )}

      <CrmBloklar7 reportsTab={reportsTab} orders={orders} quotations={quotations} inventory={inventory} exchangeRates={exchangeRates} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      <CrmBloklar8 reportsTab={reportsTab} orders={orders} quotations={quotations} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      <CrmBloklar9 reportsTab={reportsTab} orders={orders} quotations={quotations} currentLanguage={currentLanguage} fmtAna={fmtAna} />

      <CrmBloklar10 reportsTab={reportsTab} orders={orders} quotations={quotations} inventory={inventory} currentLanguage={currentLanguage} fmtAna={fmtAna} />
    </>
  );
}
