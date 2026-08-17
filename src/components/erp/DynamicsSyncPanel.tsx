/**
 * DynamicsSyncPanel.tsx — Microsoft Dynamics 365 Business Central entegrasyonu.
 *
 * Gövde ErpSyncPanel'de paylaşılıyor (2026-08-17 indirgemesi); burada yalnız
 * Dynamics'e özgü config kalır.
 *
 * Sunucu uçları:
 *   GET  /api/dynamics/status              → ErpStatusResult & { environmentName?, companyName? }
 *   POST /api/dynamics/import/stok         → ErpImportResult
 *   POST /api/dynamics/import/cari         → ErpImportResult
 *   POST /api/dynamics/export/siparis  { orderId } → { success, dynamicsOrderNo }
 *   POST /api/dynamics/export/fatura   { orderId } → { success, dynamicsInvoiceNo }
 *
 * Gerekli sunucu env değişkenleri:
 *   DYNAMICS_TENANT_ID · DYNAMICS_CLIENT_ID · DYNAMICS_CLIENT_SECRET ·
 *   DYNAMICS_ENVIRONMENT · DYNAMICS_COMPANY_ID
 */
import ErpSyncPanel, { type ErpPanelConfig } from './ErpSyncPanel';

const cfg: ErpPanelConfig = {
  key: 'dynamics',
  name: 'Microsoft Dynamics 365 Business Central',
  emoji: '🪟',
  color: '#0078d4',
  logCollection: 'dynamicsSyncLog',
  pickLogRef: e => String(e.dynamicsRef ?? ''),
  // DYNAMICS_ENVIRONMENT opsiyoneldir (varsayılan: production) — zorunlu gibi
  // listelenmesi types/erp.ts'teki requiredEnvVars ile çelişiyordu (code-review).
  envVars: ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_COMPANY_ID'],
  configHint: t => (
    <>
      {t
        ? 'Azure AD uygulama kaydı gerekir (client id/secret bu kayıttan alınır). DYNAMICS_ENVIRONMENT opsiyoneldir, varsayılan: production.'
        : 'Requires an Azure AD app registration (client id/secret come from it). DYNAMICS_ENVIRONMENT is optional, defaults to production.'}{' '}
      <a href="https://learn.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/"
         target="_blank" rel="noopener noreferrer" className="underline">
        {t ? 'Kurulum rehberi' : 'Setup guide'}
      </a>
    </>
  ),
  subtitle: status => {
    const s = status as (typeof status & { environmentName?: string; companyName?: string }) | null;
    return s?.environmentName
      ? `${s.environmentName}${s.companyName ? ' · ' + s.companyName : ''}`
      : 'OData v4 API';
  },
  exports: [
    {
      path: 'siparis',
      icon: 'siparis',
      title: t => (t ? 'Sipariş Gönder (Cetpa → Dynamics)' : 'Push Order (Cetpa → Dynamics)'),
      desc: t => (t ? 'Seçilen siparişi Dynamics\'e satış siparişi olarak gönder.' : 'Send the selected order as a sales order to Dynamics.'),
      refLabel: () => 'Ref',
      pickRef: d => String(d.dynamicsOrderNo ?? ''),
    },
    {
      path: 'fatura',
      icon: 'fatura',
      title: t => (t ? 'Fatura Gönder (Cetpa → Dynamics)' : 'Push Invoice (Cetpa → Dynamics)'),
      desc: t => (t ? 'Seçilen siparişi Dynamics\'e satış faturası olarak gönder.' : 'Send the selected order as a sales invoice to Dynamics.'),
      refLabel: () => 'Ref',
      pickRef: d => String(d.dynamicsInvoiceNo ?? ''),
    },
  ],
};

export default function DynamicsSyncPanel({ lang = 'tr' }: { lang?: string }) {
  return <ErpSyncPanel cfg={cfg} lang={lang} />;
}
