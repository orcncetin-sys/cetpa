/**
 * LogoSyncPanel.tsx — Logo Tiger / Go / Start ERP entegrasyonu.
 *
 * Gövde ErpSyncPanel'de paylaşılıyor (2026-08-17 indirgemesi); burada yalnız
 * Logo'ya özgü config kalır.
 *
 * Sunucu uçları:
 *   GET  /api/logo/status          → ErpStatusResult
 *   POST /api/logo/import/stok     → ErpImportResult
 *   POST /api/logo/import/cari     → ErpImportResult
 *   POST /api/logo/export/siparis  { orderId } → { success, logoEvrakNo }
 *
 * Gerekli sunucu env değişkenleri:
 *   LOGO_API_URL · LOGO_API_KEY · LOGO_FIRM_NO
 */
import ErpSyncPanel, { type ErpPanelConfig } from './ErpSyncPanel';

const cfg: ErpPanelConfig = {
  key: 'logo',
  name: 'Logo Tiger / Go / Start',
  emoji: '🐯',
  color: '#e63312',
  logCollection: 'logoSyncLog',
  pickLogRef: e => String(e.logoRef ?? ''),
  envVars: ['LOGO_API_URL', 'LOGO_API_KEY', 'LOGO_FIRM_NO'],
  subtitle: () => 'Logo Yazılım — REST API',
  exports: [
    {
      path: 'siparis',
      icon: 'siparis',
      title: t => (t ? 'Sipariş Gönder (Cetpa → Logo)' : 'Push Order (Cetpa → Logo)'),
      desc: t => (t ? 'Seçilen siparişi Logo\'ya satış siparişi olarak gönder.' : 'Send the selected order as a sales order to Logo.'),
      refLabel: t => (t ? 'Evrak No' : 'Doc No'),
      pickRef: d => String(d.logoEvrakNo ?? ''),
    },
  ],
};

export default function LogoSyncPanel({ lang = 'tr' }: { lang?: string }) {
  return <ErpSyncPanel cfg={cfg} lang={lang} />;
}
