import { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';
import { _registerConfirmListener, _resolveConfirm, type ConfirmOpts } from '../lib/confirm';

/**
 * App kökünde bir kez mount edilir. confirm.ts'teki imperative
 * confirmAction()/confirmDelete() çağrılarını dinler ve ConfirmModal'ı render eder.
 */
export default function GlobalConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);

  useEffect(() => _registerConfirmListener(setOpts), []);

  if (!opts) return null;

  return (
    <ConfirmModal
      isOpen
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel}
      variant={opts.variant}
      onConfirm={() => { _resolveConfirm(true); setOpts(null); }}
      onCancel={() => { _resolveConfirm(false); setOpts(null); }}
    />
  );
}
