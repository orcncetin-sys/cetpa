/**
 * IntegrationHealthPanel.tsx — tüm entegrasyonların anahtar durumu.
 *
 * /api/integrations/health'ten okur; hangi özelliğin hangi eksik anahtar
 * yüzünden çalışmadığını tek bakışta gösterir. Anahtar DEĞERLERİ asla
 * sunucudan dönmez, yalnızca yapılandırılmış/eksik durumu görünür.
 */

import React, { useEffect, useState } from 'react';
import { authFetch } from '../services/authFetch';
import { CheckCircle2, AlertCircle, RefreshCw, KeyRound } from 'lucide-react';

interface IntegrationStatus {
  id: string;
  name: string;
  configured: boolean;
  requiredKeys: string[];
  affects: string;
}

const IntegrationHealthPanel: React.FC<{ currentLanguage: string }> = ({ currentLanguage }) => {
  const tr = currentLanguage === 'tr';
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/integrations/health');
      const d = await r.json() as { integrations?: IntegrationStatus[] };
      setItems(d.integrations ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const ok = (items ?? []).filter(i => i.configured);
  const missing = (items ?? []).filter(i => !i.configured);

  return (
    <div className="apple-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-bold text-gray-900">
            {tr ? 'Entegrasyon Sağlığı' : 'Integration Health'}
          </h3>
          {items && (
            <span className="text-[11px] text-gray-400">
              {ok.length}/{items.length} {tr ? 'yapılandırılmış' : 'configured'}
            </span>
          )}
        </div>
        <button onClick={() => void load()} disabled={loading} className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!items ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {tr ? 'Kontrol ediliyor…' : 'Checking…'}
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                ⚠ {tr ? 'Anahtar eksik — bu özellikler çalışmıyor' : 'Missing keys — these features are inactive'}
              </p>
              {missing.map(i => (
                <div key={i.id} className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800">{i.name}</p>
                    <p className="text-[11px] text-gray-500">{i.affects}</p>
                    <p className="text-[10px] font-mono text-amber-700 mt-0.5">
                      {tr ? 'Gerekli' : 'Required'}: {i.requiredKeys.join(', ')}
                    </p>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">
                {tr
                  ? 'Anahtarlar sunucudaki .env.production dosyasına eklenir; container yeniden başlatılınca aktifleşir.'
                  : 'Keys go into .env.production on the server; restart the container to apply.'}
              </p>
            </div>
          )}

          {ok.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ok.map(i => (
                <span key={i.id} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
                  <CheckCircle2 className="w-3 h-3" /> {i.name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default IntegrationHealthPanel;
