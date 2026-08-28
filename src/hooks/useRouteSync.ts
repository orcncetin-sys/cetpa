/**
 * useRouteSync — bidirectional sync between App.tsx activeTab state and the URL.
 *
 * App.tsx uses a single `activeTab` state for all top-level navigation
 * (dashboard, crm, orders, inventory …).  This hook mirrors that to the URL
 * so the browser's Back/Forward buttons work and modules are deep-linkable.
 *
 * URL format:
 *   /               →  activeTab = 'dashboard'
 *   /crm            →  activeTab = 'crm'
 *   /lojistik       →  activeTab = 'lojistik'
 *   etc.
 */

import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { publicPageKey } from '../lib/publicPaths';

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

function tabToPath(tab: string): string {
  return tab === 'dashboard' ? '/' : `/${tab}`;
}

function pathToTab(pathname: string): string | null {
  if (pathname === '/') return 'dashboard';
  const seg = pathname.replace(/^\//, '').split('/')[0];
  return TOP_LEVEL_TABS.has(seg) ? seg : null;
}

interface RouteState {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function useRouteSync({ activeTab, setActiveTab }: RouteState) {
  const navigate   = useNavigate();
  const location   = useLocation();
  const syncingRef = useRef(false); // prevent feedback loops

  // ── On mount: URL → state (deep-link support) ─────────────────────────────
  useEffect(() => {
    const tab = pathToTab(location.pathname);
    if (tab && tab !== activeTab) {
      syncingRef.current = true;
      setActiveTab(tab);
      setTimeout(() => { syncingRef.current = false; }, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── On state change: state → URL ─────────────────────────────────────────
  useEffect(() => {
    if (syncingRef.current) return;
    // Genel (kimliksiz) tanıtım/yasal sayfadayken URL'e DOKUNMA. Bu efektin
    // bağımlılığı [activeTab] olduğu için MOUNT'ta da bir kez koşuyor: kullanıcı
    // /privacy'yi açtığında activeTab hâlâ 'dashboard' olur, hedef '/' çıkar ve
    // efekt sayfayı anında landing'e geri fırlatırdı. Bu guard olmadan
    // gizlilik/koşullar bağlantıları bağlansa bile AÇILMAZDI.
    if (publicPageKey(location.pathname)) return;
    if (!TOP_LEVEL_TABS.has(activeTab)) return; // sub-tabs / modals: no URL change
    const target = tabToPath(activeTab);
    if (location.pathname !== target) {
      navigate(target, { replace: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
}
