import { motion } from 'motion/react';
import { Landmark, Settings, RefreshCw, BookOpen, Save } from 'lucide-react';
import { formatCurrency, type AccountingT } from './shared';
import { oc } from '../../i18n/ortak';
import { ac } from '../../i18n/accounting';

interface BankaHareketleriTabProps {
  t: AccountingT;
  currentLanguage: string;
  mikroBankLastSync: string | null;
  showErpConfig: boolean;
  setShowErpConfig: React.Dispatch<React.SetStateAction<boolean>>;
  handleSyncMikroBank: () => void;
  mikroBankLoading: boolean;
  mikroEnabled: boolean;
  setMikroEnabled: (v: boolean) => void;
  mikroAccessToken: string;
  setMikroAccessToken: (v: string) => void;
  mikroEndpoint: string;
  setMikroEndpoint: (v: string) => void;
  erpConfigSaving: 'mikro' | 'luca' | null;
  setErpConfigSaving: (v: 'mikro' | 'luca' | null) => void;
  saveMikroConfig: () => Promise<void>;
  lucaEnabled: boolean;
  setLucaEnabled: (v: boolean) => void;
  lucaApiKey: string;
  setLucaApiKey: (v: string) => void;
  lucaCompanyId: string;
  setLucaCompanyId: (v: string) => void;
  lucaBaseUrl: string;
  setLucaBaseUrl: (v: string) => void;
  saveLucaConfig: () => Promise<void>;
  mikroBankMovements: any[];
}

export default function BankaHareketleriTab({
  t, currentLanguage, mikroBankLastSync, showErpConfig, setShowErpConfig, handleSyncMikroBank, mikroBankLoading,
  mikroEnabled, setMikroEnabled, mikroAccessToken, setMikroAccessToken, mikroEndpoint, setMikroEndpoint,
  erpConfigSaving, setErpConfigSaving, saveMikroConfig,
  lucaEnabled, setLucaEnabled, lucaApiKey, setLucaApiKey, lucaCompanyId, setLucaCompanyId, lucaBaseUrl, setLucaBaseUrl, saveLucaConfig,
  mikroBankMovements,
}: BankaHareketleriTabProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="apple-card p-4 sm:p-6 bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-bold text-[#1D1D1F] flex items-center gap-2">
              <Landmark className="text-brand w-5 h-5" />
              {ac(currentLanguage).banka_hesap_hareketleri}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {ac(currentLanguage).mikro_erp_sisteminden_cekilen_canli_banka_hareke}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mikroBankLastSync && (
              <span className="text-[10px] text-gray-400 font-medium">
                {ac(currentLanguage).son_senkronizasyon} {mikroBankLastSync}
              </span>
            )}
            <button
              onClick={() => setShowErpConfig(v => !v)}
              className="apple-button-secondary"
              title={ac(currentLanguage).baglanti_ayarlari}
            >
              <Settings className="w-4 h-4" />
              {ac(currentLanguage).baglanti_ayarlari_2}
            </button>
            <button
              onClick={handleSyncMikroBank}
              disabled={mikroBankLoading}
              className="apple-button-primary"
            >
              <RefreshCw className={`w-4 h-4 ${mikroBankLoading ? 'animate-spin' : ''}`} />
              {ac(currentLanguage).mikro_dan_cek}
            </button>
          </div>
        </div>

        {/* ── ERP Bağlantı Ayarları (Mikro / Luca kimlik bilgileri) ── */}
        {showErpConfig && (
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Mikro */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-2"><Landmark className="w-4 h-4 text-brand" /> Mikro ERP</h4>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                  <input type="checkbox" checked={mikroEnabled} onChange={e => setMikroEnabled(e.target.checked)} className="accent-[#ff4000]" />
                  {ac(currentLanguage).aktif}
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Access Token</label>
                <input type="password" value={mikroAccessToken} onChange={e => setMikroAccessToken(e.target.value)} placeholder="••••••••" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint</label>
                <input type="text" value={mikroEndpoint} onChange={e => setMikroEndpoint(e.target.value)} placeholder="https://jumpbulutapigw.mikro.com.tr/..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000] font-mono text-[11px]" />
              </div>
              <button onClick={async () => { setErpConfigSaving('mikro'); try { await saveMikroConfig(); } finally { setErpConfigSaving(null); } }} disabled={erpConfigSaving !== null} className="apple-button-primary w-full justify-center disabled:opacity-50">
                <Save size={14} /> {erpConfigSaving === 'mikro' ? (oc(currentLanguage).kaydediliyor_2) : (ac(currentLanguage).mikro_ayarlarini_kaydet)}
              </button>
              {mikroEnabled && <p className="text-[10px] text-amber-600">{ac(currentLanguage).mikro_aktif_edilince_luca_otomatik_kapanir_karsi}</p>}
            </div>
            {/* Luca */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-2"><BookOpen className="w-4 h-4 text-indigo-500" /> Luca</h4>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                  <input type="checkbox" checked={lucaEnabled} onChange={e => setLucaEnabled(e.target.checked)} className="accent-[#ff4000]" />
                  {ac(currentLanguage).aktif}
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
                <input type="password" value={lucaApiKey} onChange={e => setLucaApiKey(e.target.value)} placeholder="••••••••" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company ID</label>
                  <input type="text" value={lucaCompanyId} onChange={e => setLucaCompanyId(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
                  <input type="text" value={lucaBaseUrl} onChange={e => setLucaBaseUrl(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000] font-mono text-[11px]" />
                </div>
              </div>
              <button onClick={async () => { setErpConfigSaving('luca'); try { await saveLucaConfig(); } finally { setErpConfigSaving(null); } }} disabled={erpConfigSaving !== null} className="apple-button-primary w-full justify-center disabled:opacity-50">
                <Save size={14} /> {erpConfigSaving === 'luca' ? (oc(currentLanguage).kaydediliyor_2) : (ac(currentLanguage).luca_ayarlarini_kaydet)}
              </button>
              {lucaEnabled && <p className="text-[10px] text-amber-600">{ac(currentLanguage).luca_aktif_edilince_mikro_otomatik_kapanir}</p>}
            </div>
          </div>
        )}

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="apple-table mt-4">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 sticky top-0">
                <th className="px-4 py-3 text-left">{oc(currentLanguage).tarih}</th>
                <th className="px-4 py-3 text-left">{oc(currentLanguage).banka}</th>
                <th className="px-4 py-3 text-left">{oc(currentLanguage).aciklama}</th>
                <th className="px-4 py-3 text-right">{oc(currentLanguage).borc}</th>
                <th className="px-4 py-3 text-right">{oc(currentLanguage).alacak}</th>
                <th className="px-4 py-3 text-center">{oc(currentLanguage).doviz}</th>
              </tr>
            </thead>
            <tbody>
              {mikroBankMovements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center text-gray-400">
                    <Landmark className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">{ac(currentLanguage).henuz_hareket_bulunmuyor}</p>
                    <button onClick={handleSyncMikroBank} className="text-brand text-xs font-bold hover:underline mt-2">
                      {ac(currentLanguage).senkronizasyon_baslat}
                    </button>
                  </td>
                </tr>
              ) : (
                mikroBankMovements.map((move, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/80 transition-all group">
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                      {move.Tarih || move.date || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#1D1D1F] text-xs uppercase">{move.BankaAdi || move.bankName || 'Banka'}</div>
                      <div className="text-[10px] text-gray-400">{move.HesapNo || move.accountNo || '•••'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {move.Aciklama || move.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-red-600">
                      {move.Borc > 0 ? formatCurrency(move.Borc, move.DovizCinsi || move.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">
                      {move.Alacak > 0 ? formatCurrency(move.Alacak, move.DovizCinsi || move.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {move.DovizCinsi || move.currency || 'TRY'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
