import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronRight, X } from 'lucide-react';
import { doc, onSnapshot, setDoc, updateDoc } from '../lib/dbClient';
import { db } from '../firebase';

interface OnboardingChecklistProps {
  userId: string;
  currentLanguage: string;
  onNavigate: (tab: string, subTarget?: string) => void;
  onOpenImport?: () => void;
}

interface OnboardingStep {
  id: string;
  labelTR: string;
  labelEN: string;
  action: 'navigate' | 'import';
  target?: string;
  subTarget?: string; // hedef sayfanın alt-sekmesi / aksiyonu (doğru görünüme indir)
}

const STEPS: OnboardingStep[] = [
  { id: 'add-product',          labelTR: 'İlk ürününüzü ekleyin',                    labelEN: 'Add your first product',         action: 'navigate', target: 'inventory', subTarget: 'add' },
  { id: 'add-customer',         labelTR: 'İlk müşterinizi ekleyin',                  labelEN: 'Add your first customer',        action: 'navigate', target: 'crm',       subTarget: 'musteriler' },
  { id: 'create-order',         labelTR: 'İlk siparişi oluşturun',                   labelEN: 'Create your first order',        action: 'navigate', target: 'orders',    subTarget: 'add' },
  { id: 'setup-bank',           labelTR: 'Banka hesabı ekleyin',                     labelEN: 'Add a bank account',             action: 'navigate', target: 'muhasebe',  subTarget: 'banka' },
  { id: 'import-data',          labelTR: 'Toplu veri içe aktarın',                   labelEN: 'Bulk import your data',          action: 'import' },
  { id: 'connect-integration',  labelTR: 'Entegrasyon bağlayın (Mikro/Shopify)',     labelEN: 'Connect an integration',         action: 'navigate', target: 'settings' },
  { id: 'invite-user',          labelTR: 'Takım üyesi davet edin',                   labelEN: 'Invite a team member',           action: 'navigate', target: 'admin',     subTarget: 'invite' },
  { id: 'setup-logo',           labelTR: 'Şirket logonuzu yükleyin',                 labelEN: 'Upload your company logo',       action: 'navigate', target: 'settings' },
];

const TOTAL = STEPS.length;

export default function OnboardingChecklist({
  userId,
  currentLanguage,
  onNavigate,
  onOpenImport,
}: OnboardingChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const lang = currentLanguage === 'tr' ? 'tr' : 'en';

  // Real-time Firestore sync
  useEffect(() => {
    if (!userId) return;
    const ref = doc(db, 'userOnboarding', userId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCompletedSteps(data.completedSteps ?? []);
        setDismissed(data.dismissed ?? false);
      } else {
        // Create doc on first visit
        setDoc(ref, { completedSteps: [], dismissed: false }).catch(() => {});
      }
      setLoading(false);
    });
    return unsub;
  }, [userId]);

  const toggleStep = async (stepId: string) => {
    if (!userId) return;
    const ref = doc(db, 'userOnboarding', userId);
    const isCompleted = completedSteps.includes(stepId);
    const updated = isCompleted
      ? completedSteps.filter((s) => s !== stepId)
      : [...completedSteps, stepId];
    await updateDoc(ref, { completedSteps: updated }).catch(() => {});
  };

  const handleDismiss = async () => {
    if (!userId) return;
    const ref = doc(db, 'userOnboarding', userId);
    await updateDoc(ref, { dismissed: true }).catch(() => {});
  };

  const handleStepAction = (step: OnboardingStep) => {
    if (step.action === 'navigate' && step.target) {
      onNavigate(step.target, step.subTarget);
    } else if (step.action === 'import' && onOpenImport) {
      onOpenImport();
    }
    setIsExpanded(false);
  };

  const completedCount = completedSteps.length;
  const allDone = completedCount >= TOTAL;
  const progress = Math.min(completedCount / TOTAL, 1);

  if (loading || dismissed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[250] flex flex-col items-end gap-2">
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="apple-card w-80 max-h-[420px] overflow-y-auto flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#f0f0f2]">
              <div>
                <h3 className="font-bold text-sm text-[#1D1D1F]">
                  {lang === 'tr' ? 'Kurulum Rehberi' : 'Setup Guide'}
                </h3>
                <p className="text-xs text-[#86868B] mt-0.5">
                  {completedCount}/{TOTAL} {lang === 'tr' ? 'tamamlandı' : 'completed'}
                </p>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4 text-[#86868B]" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="px-4 pt-3 pb-1">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-[#ff4000] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress * 100}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* All complete state */}
            {allDone ? (
              <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 250 }}
                  className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center"
                >
                  <span className="text-2xl">🎉</span>
                </motion.div>
                <p className="font-bold text-[#1D1D1F] text-sm">
                  {lang === 'tr' ? 'Kurulum tamamlandı!' : 'Setup complete!'}
                </p>
                <p className="text-xs text-[#86868B]">
                  {lang === 'tr'
                    ? 'Tüm adımları başarıyla tamamladınız.'
                    : 'You\'ve completed all setup steps.'}
                </p>
                <button
                  onClick={handleDismiss}
                  className="apple-button-secondary text-xs py-1.5 px-4 mt-1"
                >
                  {lang === 'tr' ? 'Kapat' : 'Dismiss'}
                </button>
              </div>
            ) : (
              /* Step list */
              <ul className="flex flex-col divide-y divide-gray-50 px-2 py-2">
                {STEPS.map((step) => {
                  const done = completedSteps.includes(step.id);
                  return (
                    <li key={step.id} className="flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-gray-50 transition-colors group">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleStep(step.id)}
                        className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          done
                            ? 'border-green-500 bg-green-500'
                            : 'border-gray-300 hover:border-[#ff4000]'
                        }`}
                      >
                        {done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </button>

                      {/* Label */}
                      <span
                        className={`flex-1 text-xs font-medium leading-snug ${
                          done ? 'line-through text-[#86868B]' : 'text-[#1D1D1F]'
                        }`}
                      >
                        {lang === 'tr' ? step.labelTR : step.labelEN}
                      </span>

                      {/* Arrow action */}
                      <button
                        onClick={() => handleStepAction(step)}
                        className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#ff4000]/10 transition-all"
                      >
                        <ChevronRight className="w-3.5 h-3.5 text-[#ff4000]" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating trigger button */}
      <motion.button
        onClick={() => setIsExpanded((v) => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative flex items-center gap-2 bg-[#ff4000] text-white font-bold text-sm py-2.5 px-4 rounded-full shadow-lg shadow-[#ff4000]/30 transition-colors hover:bg-[#cc3200]"
      >
        <span className="text-base leading-none">🚀</span>
        <span>{completedCount}/{TOTAL}</span>

        {/* Pulsing ring when not all done */}
        {!allDone && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5">
            <span className="absolute inset-0 rounded-full bg-[#ff4000] opacity-60 animate-ping" />
            <span className="relative block w-full h-full rounded-full bg-[#ff4000]" />
          </span>
        )}
      </motion.button>
    </div>
  );
}
