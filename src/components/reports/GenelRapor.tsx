/**
 * GenelRapor.tsx — Raporlar > Genel Bakış sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'genel' sekmesine ait 78 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'genel'` koşulları BİLEREK korundu: ebeveyn zaten
 * sekmeye göre render ediyor, ama koşulu silmek binlerce satırda metin
 * dönüşümü demekti ve bu taşımanın "saf kopya" güvencesini bozardı.
 */
/*
 * 2026-08-31 bölme: dosya 3.757 satıra ulaşmıştı; bloklar src/components/reports/genel/
 * altındaki 7 bileşene ORİJİNAL SIRAYLA, içerik DEĞİŞTİRİLMEDEN taşındı (App.tsx
 * extraction deseni: props = tsc "Cannot find name" listesi). Blok içi hiçbir state/hook
 * yoktu; her bileşen yalnız kullandığı ctx alanlarını props olarak alır.
 */
import { type ReportsCtx } from './useReportsData';
import GenelOzet from './genel/GenelOzet';
import GenelBloklar1 from './genel/GenelBloklar1';
import GenelBloklar2 from './genel/GenelBloklar2';
import GenelBloklar3 from './genel/GenelBloklar3';
import GenelBloklar4 from './genel/GenelBloklar4';
import GenelBloklar5 from './genel/GenelBloklar5';
import GenelBloklar6 from './genel/GenelBloklar6';

export default function GenelRapor(ctx: ReportsCtx) {
  return (
    <>
      <GenelOzet
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        exchangeRates={ctx.exchangeRates}
        currentT={ctx.currentT}
        currentLanguage={ctx.currentLanguage}
        onNavigate={ctx.onNavigate}
        recurringOrders={ctx.recurringOrders}
        fmtAna={ctx.fmtAna}
        totalOrders={ctx.totalOrders}
        revenueSymbol={ctx.revenueSymbol}
        revenueFormatted={ctx.revenueFormatted}
        avgOrderFormatted={ctx.avgOrderFormatted}
        lowStockItems={ctx.lowStockItems}
        trendData={ctx.trendData}
        categoryChartData={ctx.categoryChartData}
        COLORS={ctx.COLORS}
        revenueCurrency={ctx.revenueCurrency}
        setRevenueCurrency={ctx.setRevenueCurrency}
      />
      <GenelBloklar1
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        exchangeRates={ctx.exchangeRates}
        currentLanguage={ctx.currentLanguage}
        fmtAna={ctx.fmtAna}
      />
      <GenelBloklar2
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        employees={ctx.employees}
        exchangeRates={ctx.exchangeRates}
        currentLanguage={ctx.currentLanguage}
        fmtAna={ctx.fmtAna}
      />
      <GenelBloklar3
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        employees={ctx.employees}
        quotations={ctx.quotations}
        inventoryMovements={ctx.inventoryMovements}
        exchangeRates={ctx.exchangeRates}
        currentLanguage={ctx.currentLanguage}
        fmtAna={ctx.fmtAna}
      />
      <GenelBloklar4
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        employees={ctx.employees}
        exchangeRates={ctx.exchangeRates}
        currentLanguage={ctx.currentLanguage}
        fmtAna={ctx.fmtAna}
      />
      <GenelBloklar5
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        currentLanguage={ctx.currentLanguage}
        fmtAna={ctx.fmtAna}
      />
      <GenelBloklar6
        reportsTab={ctx.reportsTab}
        orders={ctx.orders}
        inventory={ctx.inventory}
        employees={ctx.employees}
        quotations={ctx.quotations}
        currentLanguage={ctx.currentLanguage}
        fmtAna={ctx.fmtAna}
      />
    </>
  );
}
