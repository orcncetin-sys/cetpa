/**
 * ModuleStatusBoard — süper-admin paneli "Sistem Sağlığı & Modül Durumu".
 *
 * İki bağımsız bölüm:
 *  1) Uç Nokta Nabzı: bir grup temsili API rotasına canlı istek atıp dönen
 *     GERÇEK HTTP durum kodunu + gecikmeyi gösterir (200/401/503/vb).
 *  2) Modül Durumu: GET /api/ops/module-status'tan okunan ham dosya
 *     sinyallerinden (satır sayısı, başka yerde kullanılıyor mu, TODO/stub
 *     işareti) hesaplanan bir OLGUNLUK SEZGİSİ — kesin "bitti/eksik" iddiası
 *     değil, bu yüzden UI'da açıkça "sezgisel" ibaresi var (CLAUDE.md
 *     "sahte kesinlik gösterme" ilkesi).
 *
 * İyileştirme fikirleri grup bazında editoryel/öneri içeriktir, veri değil.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Boxes, Gauge, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Lightbulb, Radio } from 'lucide-react';
import { authedFetch } from '../lib/dbClient';

interface ModuleInfo {
  id: string; label: string; file: string; group: string;
  exists: boolean; lines: number; stubMarkers: string[]; wired: boolean; mtimeMs: number | null;
}

interface PulseTarget { id: string; label: string; path: string; }
const PULSE_TARGETS: PulseTarget[] = [
  { id: 'health', label: 'Genel Sağlık', path: '/api/health' },
  { id: 'integrations', label: 'Entegrasyon Anahtarları', path: '/api/integrations/health' },
  { id: 'watchdog', label: 'Ops Bekçisi', path: '/api/ops/watchdog' },
  { id: 'mikro', label: 'Mikro ERP', path: '/api/mikro/status' },
  { id: 'email', label: 'E-posta (Resend)', path: '/api/email/status' },
  { id: 'ai', label: 'Gemini AI', path: '/api/ai/status' },
  { id: 'parasut', label: 'Paraşüt', path: '/api/parasut/status' },
  { id: 'luca', label: 'Luca', path: '/api/luca/status' },
  { id: 'iyzico', label: 'İyzico', path: '/api/iyzico/status' },
  { id: 'whatsapp', label: 'WhatsApp', path: '/api/whatsapp/status' },
  { id: 'marketplace', label: 'Pazaryeri', path: '/api/marketplace/status' },
  { id: 'reports', label: 'Raporlar', path: '/api/reports/summary' },
  { id: 'aging', label: 'Vade Yaşlandırma', path: '/api/aging' },
  { id: 'adminstats', label: 'Admin İstatistik', path: '/api/admin/stats' },
];

interface PulseResult { id: string; label: string; status: number | null; ms: number; ok: boolean; }

// Grup bazında öneri fikirleri — editoryel içerik, veri değil.
const GROUP_IDEAS: Record<string, string[]> = {
  'Satış': [
    'CRM huni/istatistik yüzeylerinin tümü artık huniAsamasi() kullanıyor (2026-08-16) — CPQ ve Bayi Komisyonu panellerinin de aynı 8-durumlu Lead.status setini kullanıp kullanmadığı kontrol edilmeli.',
    'B2B Portal + Servis + İhracat modülleri arasında "müşteri arama" bileşeni 3 farklı yerde ayrı yazıldı (bkz. task_928695ef) — tek bir CustomerCombobox\'a indirgemek gelecekteki sürüklenmeyi önler.',
  ],
  'Muhasebe': [
    'Maliyet Merkezi/Gelir Tanıma/Muhtasar/Sabit Kıymet gibi alt modüllerin Mikro senkronuyla ADDITIVE bağlı olup olmadığı (native veri silinmeden) tek tek doğrulanmalı — bugüne kadar yalnız KDV/Satışlar/Bilanço/Finans için bu doğrulandı.',
    'AccountingModule.tsx içindeki sıralama karşılaştırıcıları (~10 yeni dal, 2026-08-16) tekrarlanan localeCompare bloklarını shared.ts\'e taşımayı hak ediyor.',
  ],
  'Stok': [
    'Lot/Seri Takip ve Mobil WMS modüllerinin locationStocks (Faz2, konum-bazlı stok) ile aynı veri kaynağını mı yoksa ayrı bir stok görünümünü mü kullandığı netleştirilmeli — iki kaynak birbirinden sapabilir.',
  ],
  'IK': [
    'Performans modülünün HR modülüyle aynı çalışan koleksiyonunu paylaşıp paylaşmadığı, yoksa ayrı bir "performans kaydı" mı tuttuğu doğrulanmalı.',
  ],
  'Üretim': [
    'MRP/BOM/Üretim/Bakım modülleri arasında ürün ağacı (BOM) verisinin tek kaynaktan mı geldiği kontrol edilmeli — birden fazla modül aynı reçeteyi farklı şekilde tutuyorsa senkron sorunu doğar.',
  ],
  'Yönetim': [
    'Holding/Şube/Kurumsal Yönetim modüllerinin çok-kiracılı (multi-tenant) izolasyon deseniyle (companyId filtreleme) uyumlu olduğu 2026-06-22 denetiminden bu yana yeniden doğrulanmadı.',
  ],
  'Entegrasyon': [
    'ERP Hub + SKU Eşleştirme + Pazaryeri panelleri zaten var; SAP/Logo/Dynamics uçları (server.ts /api/logo,dynamics,sap/status) hâlâ yalnızca "configured: false" dönen stub — gerçek entegrasyon yazılmadıysa bu paneller kullanıcıya net şekilde "planlanan, henüz bağlı değil" demeli.',
  ],
  'Rapor': [
    'Analitik panelinin Raporlar sayfasıyla içerik çakışması olup olmadığı (aynı KPI\'lar iki yerde farklı hesaplanıyor mu) tek seferlik bir karşılaştırmayla doğrulanabilir.',
  ],
  'Satın Alma': [
    'PurchasingModule.tsx sıralama düzeltmesi (2026-08-16) sırasında ETA alanının Timestamp normalizasyonu 4. kez tekrar yazıldı (bkz. code review bulgusu) — tek bir toDateOrNull() yardımcı fonksiyonu tüm dosyada tekrar kullanılmalı.',
  ],
  'Genel': [
    'Dashboard\'daki Stok Değeri Özeti marj hesabı, Mikro maliyet senkronunun (GenelAmacliMaliyetListesiV2) doğru mu kümülatif mi olduğu netleşene kadar şüpheli işaretli kalmalı (2026-08-16 kullanıcı sorusu — henüz kök nedene inilmedi).',
  ],
};

export default function ModuleStatusBoard({ currentLanguage, toast }: { currentLanguage: string; toast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const tr = currentLanguage === 'tr';
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  const [loadingModules, setLoadingModules] = useState(false);
  const [pulse, setPulse] = useState<PulseResult[] | null>(null);
  const [pulsing, setPulsing] = useState(false);

  const loadModules = async () => {
    setLoadingModules(true);
    try {
      const r = await authedFetch('/api/ops/module-status');
      const d = await r.json();
      setModules(Array.isArray(d.modules) ? d.modules : []);
    } catch { toast(tr ? 'Modül durumu okunamadı.' : 'Could not read module status.', 'error'); }
    finally { setLoadingModules(false); }
  };

  const runPulse = async () => {
    setPulsing(true);
    const results = await Promise.all(PULSE_TARGETS.map(async (t): Promise<PulseResult> => {
      const t0 = performance.now();
      try {
        const r = await authedFetch(t.path);
        return { id: t.id, label: t.label, status: r.status, ms: Math.round(performance.now() - t0), ok: r.status < 400 };
      } catch {
        return { id: t.id, label: t.label, status: null, ms: Math.round(performance.now() - t0), ok: false };
      }
    }));
    setPulse(results);
    setPulsing(false);
  };

  useEffect(() => { void loadModules(); void runPulse(); }, []);

  const maturity = (m: ModuleInfo): { icon: ReactElement; label: string; color: string } => {
    if (!m.exists) return { icon: <XCircle className="w-3.5 h-3.5" />, label: tr ? 'Dosya yok' : 'File missing', color: 'text-red-500 bg-red-50' };
    if (m.stubMarkers.length > 0) return { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: tr ? `Stub işareti (${m.stubMarkers.length})` : `Stub marker (${m.stubMarkers.length})`, color: 'text-amber-600 bg-amber-50' };
    if (!m.wired) return { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: tr ? 'Başka yerde kullanılmıyor?' : 'Not referenced elsewhere?', color: 'text-amber-600 bg-amber-50' };
    if (m.lines < 150) return { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: tr ? 'Küçük dosya' : 'Small file', color: 'text-amber-600 bg-amber-50' };
    return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: tr ? 'Geliştirilmiş görünüyor' : 'Looks developed', color: 'text-emerald-600 bg-emerald-50' };
  };

  const grouped = (modules ?? []).reduce<Record<string, ModuleInfo[]>>((acc, m) => {
    (acc[m.group] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Uç Nokta Nabzı */}
      <div className="apple-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${pulse ? (pulse.every(p => p.ok) ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600') : 'bg-gray-100 text-gray-400'}`}>
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1D1D1F]">{tr ? 'Uç Nokta Nabzı' : 'Endpoint Pulse'}</h3>
            <p className="text-[11px] text-[#86868B]">{tr ? 'Canlı istek — gerçek HTTP durum kodu + gecikme' : 'Live request — real HTTP status + latency'}</p>
          </div>
          <button onClick={() => void runPulse()} disabled={pulsing} className="apple-button-secondary ml-auto text-xs flex items-center gap-1.5 px-2.5 py-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${pulsing ? 'animate-spin' : ''}`} />{tr ? 'Yeniden Dene' : 'Retry'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {(pulse ?? PULSE_TARGETS.map(t => ({ id: t.id, label: t.label, status: null, ms: 0, ok: false }))).map(p => (
            <div key={p.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-2.5 py-2">
              <span className="text-[#1D1D1F] font-medium truncate">{p.label}</span>
              <span className={`font-mono font-bold shrink-0 ml-2 ${p.status === null ? 'text-gray-400' : p.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {p.status ?? (pulsing ? '…' : '—')}{p.status !== null && <span className="text-[9px] text-gray-400 font-normal"> {p.ms}ms</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Modül Durumu */}
      <div className="apple-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-100 text-indigo-600">
            <Boxes className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1D1D1F]">{tr ? 'Modül Durumu' : 'Module Status'}</h3>
            <p className="text-[11px] text-[#86868B]">
              {tr ? 'Sezgisel gösterge (dosya boyutu + kullanım + stub işareti) — kesin bir iddia değil' : 'Heuristic (file size + usage + stub markers) — not a definitive claim'}
            </p>
          </div>
          <button onClick={() => void loadModules()} disabled={loadingModules} className="apple-button-secondary ml-auto text-xs flex items-center gap-1.5 px-2.5 py-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingModules ? 'animate-spin' : ''}`} />{tr ? 'Yenile' : 'Refresh'}
          </button>
        </div>

        {!modules ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {tr ? 'Taranıyor…' : 'Scanning…'}</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([group, mods]) => (
              <div key={group}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Gauge className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{group}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-1.5 mb-2">
                  {mods.map(m => {
                    const ms = maturity(m);
                    return (
                      <div key={m.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-2.5 py-1.5">
                        <span className="text-[#1D1D1F] font-medium truncate">{m.label}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 shrink-0 ml-2 ${ms.color}`} title={`${m.lines} satır${m.stubMarkers.length ? ' · ' + m.stubMarkers.join(', ') : ''}`}>
                          {ms.icon}<span className="text-[10px] font-semibold">{ms.label}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {GROUP_IDEAS[group] && (
                  <div className="space-y-1 pl-1">
                    {GROUP_IDEAS[group].map((idea, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11px] text-gray-500">
                        <Lightbulb className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                        <span>{idea}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
