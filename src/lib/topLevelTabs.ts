/**
 * topLevelTabs.ts — üst düzey sekme ↔ URL segmenti eşlemesinin TEK kaynağı.
 *
 * useRouteSync.ts'ten AYRILDI (2026-08-28): sunucu tarafı (trafik sayacının
 * yol-kovası doğrulaması, src/server/routes/trafikRoutes.ts) bu listeye
 * muhtaç. Sunucunun bir React hook DOSYASINI import etmesi çalışıyordu ama
 * kırılgandı — useRouteSync'e tarayıcı-özel kod girse sunucu boot'u ölürdü.
 * Liste artık iki tarafın da güvenle import edebileceği saf bir modülde;
 * useRouteSync geriye dönük uyumluluk için re-export ediyor.
 */
// Top-level tabs that map 1-to-1 with URL path segments.
// 'finans' was a typo that never matched the real activeTab ('finance') — this
// silently disabled URL sync (deep-link + back/forward) for the whole Holding
// tab group (dunning/gelirtanima/finance/ebelge/vergi all missing too), which
// is why switching those tabs left the URL path stuck on '/holding' with only
// the unrelated hash changing (2026-08-13 kullanıcı bulgusu, app.cetpa.com.tr/holding#finance).
export const TOP_LEVEL_TABS = new Set([
  'dashboard', 'crm', 'orders', 'inventory', 'lojistik', 'muhasebe',
  'satin-alma', 'ik', 'hukuk', 'uretim', 'kalite', 'proje', 'servis',
  'bakim', 'raporlar', 'finance', 'ayarlar', 'entegrasyonlar', 'b2b',
  'holding', 'ihracat', 'sube', 'performans',
  'dunning', 'gelirtanima', 'ebelge', 'vergi',
]);
