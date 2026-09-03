/**
 * KurumsalPage — Kurumsal Yönetim sekmesi.
 * RBAC sarmalayıcı (UnauthorizedView / ReadOnlyBanner) + CorporateGovernanceModule.
 *
 * App.tsx'ten ÇIKARILDI (2026-09-03, App.tsx bölme hattı — kurumsal blok ~11
 * satırdı; içerik zaten CorporateGovernanceModule'de). Davranış birebir
 * taşındı: gövde bayt-bayt kesildi, yalnız girinti tekdüze azaltıldı.
 */
import { motion } from 'motion/react';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import CorporateGovernanceModule from '../components/CorporateGovernanceModule';

interface Props {
  currentLanguage: 'tr' | 'en';
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  /** Yalnız !!user (oturum açık mı) için kullanılıyor (firebase User yapısal olarak uyar). */
  user: { uid: string } | null;
  /** App'te UserRole enum'u — string enum olduğundan yapısal olarak uyar. */
  userRole: string | null;
  setActiveTab: (tab: string) => void;
}

export default function KurumsalPage({
  currentLanguage, canAccess, hasFullAccess, user, userRole, setActiveTab,
}: Props) {
  return (
    <motion.div key="kurumsal" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      {!canAccess('kurumsal') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Kurumsal Yönetim':'Corporate Governance'} /> : (
        <>
          {!hasFullAccess('kurumsal') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
          <CorporateGovernanceModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('kurumsal')} userRole={userRole} onNavigate={setActiveTab} />

        </>
      )}
    </motion.div>
  );
}
