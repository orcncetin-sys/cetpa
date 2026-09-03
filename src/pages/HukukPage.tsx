/**
 * HukukPage — Hukuk & Uyum sekmesi.
 * Phase 598 sözleşme yenileme uyarıları (p597Contracts proxy'si üzerinden)
 * + LegalModule (sözleşmeler, davalar, KVKK uyum).
 *
 * App.tsx'ten ÇIKARILDI (2026-09-03, App.tsx bölme hattı — hukuk bloğu ~42
 * satırdı). Davranış birebir taşındı: gövde bayt-bayt kesildi, yalnız girinti
 * tekdüze azaltıldı.
 */
import React from 'react';
import { motion } from 'motion/react';
import { Scale } from 'lucide-react';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ModuleHeader from '../components/ModuleHeader';
import LegalModule from '../components/LegalModule';

/** App.tsx'teki p597Contracts state'inin eleman tipiyle birebir aynı tanım. */
export interface P597Contract { id: string; customerName: string; totalValue: number; startDate: string; endDate: string; recognized: number }

interface Props {
  currentLanguage: 'tr' | 'en';
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  /** Yalnız !!user (oturum açık mı) için kullanılıyor (firebase User yapısal olarak uyar). */
  user: { uid: string } | null;
  p597Contracts: P597Contract[];
  p598AlertDays: number;
  setP598AlertDays: React.Dispatch<React.SetStateAction<number>>;
}

export default function HukukPage({
  currentLanguage, canAccess, hasFullAccess, user,
  p597Contracts, p598AlertDays, setP598AlertDays,
}: Props) {
  return (
    <motion.div key="hukuk" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      {!canAccess('hukuk') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Hukuk & Uyum':'Legal & Compliance'} /> : (
        <>
          {!hasFullAccess('hukuk') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
          <ModuleHeader 
            title={currentLanguage === 'tr' ? 'Hukuk & Uyum' : 'Legal & Compliance'} 
            subtitle={currentLanguage === 'tr' ? 'Sözleşmeler, davalar ve KVKK uyum süreçleri' : 'Contracts, cases and GDPR compliance processes'}
            icon={Scale}
          />
          {/* ── Phase 598: Sözleşme Yenileme Uyarıları ─────────────────── */}
          {(() => {
            const tr598 = currentLanguage === 'tr';
            const today598 = new Date().toISOString().slice(0,10);
            const alertDate598 = new Date(Date.now()+p598AlertDays*86400000).toISOString().slice(0,10);
            // Use contracts from LegalModule's Firestore — but we don't have them directly
            // Instead show alert config + derive from p597Contracts as a proxy
            const expiringContracts = p597Contracts.filter(c=>c.endDate&&c.endDate>=today598&&c.endDate<=alertDate598);
            const expiredContracts = p597Contracts.filter(c=>c.endDate&&c.endDate<today598);
            if (expiringContracts.length===0&&expiredContracts.length===0&&p597Contracts.length===0) return null;
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 text-sm">{tr598?'📋 Sözleşme Yenileme Uyarıları':'📋 Contract Renewal Alerts'}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{tr598?'Uyarı eşiği:':'Alert threshold:'}</span>
                    <input type="number" value={p598AlertDays} onChange={e=>setP598AlertDays(Number(e.target.value))} className="apple-input px-2 py-1 text-xs w-14 text-right" />
                    <span className="text-xs text-gray-500">{tr598?'gün':'days'}</span>
                  </div>
                </div>
                {expiredContracts.length>0&&(<div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2"><p className="text-xs text-red-700 font-bold">❌ {expiredContracts.length} {tr598?'sözleşme süresi dolmuş:':'contract(s) expired:'} {expiredContracts.map(c=>c.customerName).join(', ')}</p></div>)}
                {expiringContracts.length>0&&(<div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"><p className="text-xs text-amber-700 font-bold">⚠️ {expiringContracts.length} {tr598?`sözleşme ${p598AlertDays} gün içinde sona eriyor:`:`contract(s) expiring in ${p598AlertDays} days:`} {expiringContracts.map(c=>`${c.customerName} (${c.endDate})`).join(', ')}</p></div>)}
                {expiringContracts.length===0&&expiredContracts.length===0&&(<p className="text-center py-4 text-gray-400 text-xs">{tr598?'Yaklaşan sözleşme yenileme yok.':'No upcoming contract renewals.'}</p>)}
                <p className="text-[10px] text-gray-400 mt-2">* {tr598?'Gelir Tanıma modülünde kayıtlı sözleşmeler izlenmektedir.':'Contracts from Revenue Recognition module are monitored here.'}</p>
              </div>
            );
          })()}
          <LegalModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('hukuk')} />
        </>
      )}
    </motion.div>
  );
}
