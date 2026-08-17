/**
 * SAPSyncPanel.tsx — SAP Business One (Service Layer) entegrasyonu.
 *
 * Gövde ErpSyncPanel'de paylaşılıyor (2026-08-17 indirgemesi); burada yalnız
 * SAP'a özgü config kalır.
 *
 * Sunucu uçları:
 *   GET  /api/sap/status              → ErpStatusResult & { companyDb?, sapVersion? }
 *   POST /api/sap/import/stok         → ErpImportResult
 *   POST /api/sap/import/cari         → ErpImportResult
 *   POST /api/sap/export/siparis  { orderId } → { success, sapDocEntry, sapDocNum }
 *   POST /api/sap/export/fatura   { orderId } → { success, sapDocEntry, sapDocNum }
 *
 * Gerekli sunucu env değişkenleri:
 *   SAP_SERVICE_LAYER_URL · SAP_USERNAME · SAP_PASSWORD · SAP_COMPANY_DB
 */
import ErpSyncPanel, { type ErpPanelConfig } from './ErpSyncPanel';

/** SAP yanıtı HEM DocEntry (Service Layer anahtarı, GET /Orders(DocEntry) için
 *  gerekli) HEM DocNum (kullanıcıya görünen numara) döner. Orijinal panel ikisini
 *  birden gösteriyordu; indirgemede yalnız biri kalmıştı (code-review bulgusu). */
const sapRef = (d: Record<string, unknown>) =>
  `DocEntry: ${d.sapDocEntry ?? '—'} · DocNum: ${d.sapDocNum ?? '—'}`;

const cfg: ErpPanelConfig = {
  key: 'sap',
  name: 'SAP Business One',
  emoji: '🔷',
  color: '#0070f3',
  logCollection: 'sapSyncLog',
  // Log kaydında 'sapRef' diye bir alan YOK — orijinal panel DocEntry/DocNum
  // okuyordu (code-review bulgusu; 'sapRef' uydurmaydı, hep boş kalırdı).
  pickLogRef: e => (e.sapDocEntry || e.sapDocNum)
    ? `DocEntry:${e.sapDocEntry ?? '—'} · DocNum:${e.sapDocNum ?? '—'}` : '',
  envVars: ['SAP_SERVICE_LAYER_URL', 'SAP_USERNAME', 'SAP_PASSWORD', 'SAP_COMPANY_DB'],
  configHint: t => (t
    ? 'Service Layer genelde 50000 portunda çalışır — sunucu güvenlik duvarında bu porta izin verildiğinden emin olun. Oturum ~5 dk hareketsizlikte düşer, panel gerektiğinde yeniden bağlanır.'
    : 'Service Layer usually listens on port 50000 — make sure your firewall allows it. Sessions idle out after ~5 min; the panel reconnects as needed.'),
  subtitle: status => {
    const s = status as (typeof status & { companyDb?: string; sapVersion?: string }) | null;
    return s?.connected && s.companyDb
      ? `${s.companyDb}${s.sapVersion ? ' · v' + s.sapVersion : ''}`
      : 'Service Layer API';
  },
  exports: [
    {
      path: 'siparis',
      icon: 'siparis',
      title: t => (t ? 'Sipariş Gönder (Cetpa → SAP)' : 'Push Order (Cetpa → SAP)'),
      desc: t => (t ? 'Seçilen siparişi SAP\'a satış siparişi olarak gönder.' : 'Send the selected order as a sales order to SAP.'),
      refLabel: () => 'SAP',
      pickRef: sapRef,
    },
    {
      path: 'fatura',
      icon: 'fatura',
      title: t => (t ? 'Fatura Gönder (Cetpa → SAP)' : 'Push Invoice (Cetpa → SAP)'),
      desc: t => (t ? 'Seçilen siparişi SAP\'a A/R fatura olarak gönder.' : 'Send the selected order as an A/R invoice to SAP.'),
      refLabel: () => 'SAP',
      pickRef: sapRef,
    },
  ],
};

export default function SAPSyncPanel({ lang = 'tr' }: { lang?: string }) {
  return <ErpSyncPanel cfg={cfg} lang={lang} />;
}
