/**
 * MikroPushButton.tsx — herhangi bir modülden Mikro'ya evrak gönderme butonu.
 *
 * Kullanım:
 *   <MikroPushButton
 *     label="Mikro'ya Gönder"
 *     method="VerilenTeklifKaydetV2"
 *     buildPayload={() => teklifPayload({...})}
 *     entityType="quotation" entityId={q.id}
 *     onSuccess={() => ...}
 *   />
 *
 * Sonuç butonun yanında gösterilir; tüm denemeler sunucuda syncLog +
 * auditLog'a düşer.
 */

import React, { useState } from 'react';
import { pushMikroEvrak } from '../services/mikroEvrak';

interface Props {
  label?: string;
  method: string;
  buildPayload: () => Record<string, unknown> | null; // null → doğrulama hatası (buton kendi mesajını basar)
  entityType?: string;
  entityId?: string;
  onSuccess?: () => void;
  className?: string;
  compact?: boolean;
}

const MikroPushButton: React.FC<Props> = ({
  label = "Mikro'ya Gönder", method, buildPayload, entityType, entityId, onSuccess, className, compact,
}) => {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = buildPayload();
    if (!payload) { setState('err'); setMsg('Eksik veri — gönderilemedi'); return; }
    setState('busy'); setMsg(null);
    try {
      const r = await pushMikroEvrak(method, payload, { entityType, entityId });
      if (r.notConfigured) { setState('err'); setMsg('Mikro yapılandırılmamış'); return; }
      if (r.success) { setState('ok'); setMsg('Mikro’ya kaydedildi ✓'); onSuccess?.(); }
      else { setState('err'); setMsg((r.error || 'Hata').slice(0, 90)); }
    } catch (err) {
      setState('err'); setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={run}
        disabled={state === 'busy'}
        title={`Mikro: ${method}`}
        className={className ?? `inline-flex items-center gap-1 rounded-full font-semibold transition-colors disabled:opacity-50 ${
          compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-3 py-1.5'
        } ${state === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c]/20'}`}
      >
        {state === 'busy' ? '⏳' : state === 'ok' ? '✓' : '⇪'} {compact ? (label !== "Mikro'ya Gönder" ? label : 'Mikro') : label}
      </button>
      {msg && (
        <span className={`text-[10px] ${state === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>{msg}</span>
      )}
    </span>
  );
};

export default MikroPushButton;
