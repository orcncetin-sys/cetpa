import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Download,
  Package, Users, Activity, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { collection, doc, query, limit, onSnapshot } from '../lib/dbClient';
import { db, auth } from '../firebase';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  getMikroStatus,
  importStokFromMikro,
  importCariFromMikro,
  MikroStatus,
  MikroImportResult,
} from '../services/mikroService';
import { getSyncQueueStats, clearDeadJobs } from '../services/syncRetryService';
import { processMikroRetries } from '../services/mikroEvrak';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PullState {
  running: boolean;
  result: string | null;
  error: string | null;
}

interface SyncLogEntry {
  id: string;
  operation: string;
  entityType: string;
  entityId: string;
  success: boolean;
  mikroRef: string | null;
  error: string | null;
  duration: number;
  timestamp?: { toDate: () => Date };
}

interface ImportState {
  running: boolean;
  result: MikroImportResult | null;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
      ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function OpBadge({ op }: { op: string }) {
  const colors: Record<string, string> = {
    StokKaydetV2:    'bg-blue-100 text-blue-700',
    StokListesiV2:   'bg-blue-50  text-blue-500',
    CariKaydetV2:    'bg-purple-100 text-purple-700',
    CariListesiV2:   'bg-purple-50  text-purple-500',
    SiparisKaydetV2: 'bg-orange-100 text-orange-700',
    ImportStok:      'bg-teal-100 text-teal-700',
    ImportCari:      'bg-teal-50  text-teal-600',
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[op] || 'bg-gray-100 text-gray-600'}`}>
      {op}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface MikroSyncPanelProps {
  currentLanguage?: string;
}

export default function MikroSyncPanel({ currentLanguage = 'tr' }: MikroSyncPanelProps) {
  const t = currentLanguage === 'tr';

  // Status
  const [status, setStatus] = useState<MikroStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Retry kuyruğu durumu (başarısız push'lar)
  const [queueStats, setQueueStats] = useState<{ queued: number; dead: number; lastSuccess: number | null } | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const refreshQueue = useCallback(async () => {
    try { const s = await getSyncQueueStats(); setQueueStats({ queued: s.queued, dead: s.dead, lastSuccess: s.lastSuccess }); }
    catch { /* sessiz */ }
  }, []);
  useEffect(() => { void refreshQueue(); }, [refreshQueue]);

  // Import states
  const [stokImport, setStokImport] = useState<ImportState>({ running: false, result: null, error: null });
  const [cariImport, setCariImport] = useState<ImportState>({ running: false, result: null, error: null });

  // Pull-flow states
  const defaultPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [pullPeriod, setPullPeriod] = useState(defaultPeriod);
  const [bakiyePull, setBakiyePull] = useState<PullState>({ running: false, result: null, error: null });
  const [mizanPull,  setMizanPull]  = useState<PullState>({ running: false, result: null, error: null });
  const [kdvPull,    setKdvPull]    = useState<PullState>({ running: false, result: null, error: null });

  // Stok miktar işi (jobs/stokMiktarImport canlı izlenir)
  const [miktarJob, setMiktarJob] = useState<{ running?: boolean; processed?: number; updated?: number; failed?: number; total?: number; error?: string | null } | null>(null);
  const [miktarStarting, setMiktarStarting] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'jobs', 'stokMiktarImport'), snap => {
      setMiktarJob(snap.exists() ? snap.data() as typeof miktarJob : null);
    }, () => {});
    return () => unsub();
  }, []);

  async function handleStartMiktar() {
    setMiktarStarting(true);
    try {
      const r = await fetch('/api/mikro/import/stok-miktar', { method: 'POST', headers: await authHeaders() });
      const d = await r.json() as { success: boolean; started?: boolean; alreadyRunning?: boolean; error?: string };
      if (!d.success) throw new Error(d.error || 'Hata');
    } catch (e) {
      setMiktarJob(prev => ({ ...prev, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setMiktarStarting(false);
    }
  }

  // ── Gelen e-Fatura Kabul / Ret ────────────────────────────────────────────
  interface GelenFatura { id: string; cha_Guid?: string; cha_evrakno_seri?: string; cha_evrakno_sira?: string; cha_tarihi?: string; cha_kod?: string; cha_meblag?: number; gibDurumu?: string; gibKabulAt?: unknown; gibRetAt?: unknown; gibRetAciklama?: string; }
  const [gelenFaturalar, setGelenFaturalar] = useState<GelenFatura[]>([]);
  const [gibAction, setGibAction] = useState<Record<string, { running: boolean; error: string | null }>>({});
  const [retModal, setRetModal] = useState<{ id: string; guid: string } | null>(null);
  const [retAciklama, setRetAciklama] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'mikroFaturalar'), limit(50));
    const unsub = onSnapshot(q, snap => {
      const alis = snap.docs
        .filter(d => (d.data() as GelenFatura & { yon?: string }).yon === 'alis')
        .map(d => ({ id: d.id, ...(d.data() as GelenFatura) }));
      setGelenFaturalar(alis);
    }, () => {});
    return () => unsub();
  }, []);

  async function handleGibKabul(id: string, guid: string) {
    setGibAction(p => ({ ...p, [id]: { running: true, error: null } }));
    try {
      const r = await fetch('/api/mikro/gelen-fatura/kabul', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ faturaGuid: guid, firebaseId: id }),
      });
      const d = await r.json() as { success: boolean; error?: string };
      if (!d.success) throw new Error(d.error || 'Kabul başarısız');
      setGibAction(p => ({ ...p, [id]: { running: false, error: null } }));
    } catch (e) {
      setGibAction(p => ({ ...p, [id]: { running: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  async function handleGibRet(id: string, guid: string, aciklama: string) {
    setGibAction(p => ({ ...p, [id]: { running: true, error: null } }));
    setRetModal(null);
    try {
      const r = await fetch('/api/mikro/gelen-fatura/ret', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ faturaGuid: guid, firebaseId: id, aciklama }),
      });
      const d = await r.json() as { success: boolean; error?: string };
      if (!d.success) throw new Error(d.error || 'Red başarısız');
      setGibAction(p => ({ ...p, [id]: { running: false, error: null } }));
    } catch (e) {
      setGibAction(p => ({ ...p, [id]: { running: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  // Sync log
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);

  // ── Live syncLog subscription ──────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'syncLog'),
      limit(30)
    );
    const unsub = onSnapshot(q, snap => {
      setSyncLog(snap.docs.map(d => ({ id: d.id, ...d.data() } as SyncLogEntry)));
    });
    return () => unsub();
  }, []);

  // ── Status check ───────────────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      const s = await getMikroStatus();
      setStatus(s);
    } catch {
      setStatus({ configured: false, connected: false, error: 'Bağlantı hatası' });
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // ── Import handlers ────────────────────────────────────────────────────────
  async function handleImportStok() {
    setStokImport({ running: true, result: null, error: null });
    try {
      const result = await importStokFromMikro();
      setStokImport({ running: false, result, error: result.success ? null : (result.error || 'Bilinmeyen hata') });
    } catch (e) {
      setStokImport({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleImportCari() {
    setCariImport({ running: true, result: null, error: null });
    try {
      const result = await importCariFromMikro();
      setCariImport({ running: false, result, error: result.success ? null : (result.error || 'Bilinmeyen hata') });
    } catch (e) {
      setCariImport({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Pull-flow handlers ─────────────────────────────────────────────────────
  async function authHeaders(): Promise<Record<string, string>> {
    const token = await auth.currentUser?.getIdToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function handlePullBakiye() {
    setBakiyePull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/bakiye', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({}) });
      const d = await r.json() as { success: boolean; updated?: number; skipped?: number; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setBakiyePull({ running: false, result: `${t ? 'Güncellendi' : 'Updated'}: ${d.updated ?? 0} / ${t ? 'Atlandı' : 'Skipped'}: ${d.skipped ?? 0}`, error: null });
    } catch (e) {
      setBakiyePull({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handlePullMizan() {
    setMizanPull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/mizan', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ period: pullPeriod }) });
      const d = await r.json() as { success: boolean; period?: string; rows?: number; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setMizanPull({ running: false, result: `${t ? 'Dönem' : 'Period'}: ${d.period ?? pullPeriod} · ${d.rows ?? 0} ${t ? 'satır' : 'rows'}`, error: null });
    } catch (e) {
      setMizanPull({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handlePullKdv() {
    setKdvPull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/kdv', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ period: pullPeriod }) });
      const d = await r.json() as { success: boolean; period?: string; kdvMatrahi?: number; hesaplananKdv?: number; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setKdvPull({ running: false, result: `${t ? 'Matrah' : 'Base'}: ₺${(d.kdvMatrahi ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} · KDV: ₺${(d.hesaplananKdv ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, error: null });
    } catch (e) {
      setKdvPull({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Diğer Mikro listeleri (genel import factory endpoint'leri) ─────────────
  const [extraPulls, setExtraPulls] = useState<Record<string, PullState>>({});
  async function handleExtraPull(key: string, route: string) {
    setExtraPulls(p => ({ ...p, [key]: { running: true, result: null, error: null } }));
    try {
      const r = await fetch(route, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({}) });
      const d = await r.json() as { success: boolean; total?: number; note?: string | null; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setExtraPulls(p => ({ ...p, [key]: {
        running: false,
        result: `${d.total ?? 0} ${t ? 'kayıt' : 'records'}${d.note ? ` · ${d.note}` : ''}`,
        error: null,
      } }));
    } catch (e) {
      setExtraPulls(p => ({ ...p, [key]: { running: false, result: null, error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  // ── Tümünü Çek ─────────────────────────────────────────────────────────────
  // Tek tek basmak zahmetli. Adımlar SIRAYLA koşar, paralel DEĞİL: Mikro API'si
  // aynı makinede tek servis olarak çalışıyor ve eşzamanlı yükte çökebiliyor
  // (Mikro desteğinin 2026-06-11'de kabul ettiği davranış). Sıralı koşum hem
  // güvenli hem de hangi adımın patladığını net gösteriyor.
  //
  // Bir adım başarısız olursa DURMAZ — kalanlar koşar, sonuçta özet verilir.
  // Bu kurulumda Mizan/KDV/Siparişler/Ödeme Planları yapısal olarak boş
  // (Mikro'da o modüller kullanılmıyor); yine de koşulurlar ki durum değişirse
  // kendiliğinden dolsunlar.
  // Ham satır temizliği — 2026-08-01'de banka/kasa import'ları ham Mikro
  // satırlarını tipli UI koleksiyonlarına dökmüştü ve Muhasebe modülü
  // çöküyordu. Import düzeltildi; bu düğme CANLIDA kalmış kirli kayıtları siler.
  const [temizlikRunning, setTemizlikRunning] = useState(false);
  const [temizlikSonuc, setTemizlikSonuc] = useState<string | null>(null);

  async function handleHamSatirTemizle() {
    if (temizlikRunning) return;
    setTemizlikRunning(true);
    setTemizlikSonuc(null);
    try {
      const r = await fetch('/api/mikro/tamir/ham-satir-temizle', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({}) });
      const d = await r.json() as { success?: boolean; silinen?: Record<string, number>; error?: string };
      if (!r.ok || !d.success) { setTemizlikSonuc(d.error || 'Temizlik başarısız.'); return; }
      const toplam = Object.values(d.silinen ?? {}).reduce((a, b) => a + b, 0);
      setTemizlikSonuc(toplam === 0
        ? 'Temizlenecek ham satır bulunamadı.'
        : `${toplam} ham satır silindi (${Object.entries(d.silinen ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ')}). Banka/Kasa/Depo import'larını yeniden çalıştırın.`);
    } catch {
      setTemizlikSonuc('Temizlik başarısız — sunucuya ulaşılamadı.');
    } finally {
      setTemizlikRunning(false);
    }
  }

  const [tumuRunning, setTumuRunning] = useState(false);
  const [tumuAdim, setTumuAdim] = useState<string | null>(null);
  const [tumuOzet, setTumuOzet] = useState<{ ok: number; hata: number; bitti: boolean } | null>(null);

  async function handleTumunuCek() {
    if (tumuRunning) return;
    setTumuRunning(true);
    setTumuOzet(null);
    let ok = 0, hata = 0;

    // Sıra bilinçli: önce kart/tanım verisi, sonra hareket verisi, en son
    // arka planda koşan uzun iş (stok miktarı) — o bittiğinde diğerleri hazır olur.
    const adimlar: { ad: string; calistir: () => Promise<void> }[] = [
      { ad: t ? 'Stok kartları' : 'Stock cards',   calistir: handleImportStok },
      { ad: t ? 'Cariler' : 'Customers',           calistir: handleImportCari },
      ...extraPullDefs
        .filter(d => d.key !== 'stok-miktar')
        .map(d => ({ ad: d.title, calistir: () => handleExtraPull(d.key, d.route) })),
      { ad: t ? 'Cari bakiyeler' : 'Balances',     calistir: handlePullBakiye },
      { ad: t ? 'Mizan' : 'Trial balance',         calistir: handlePullMizan },
      { ad: t ? 'KDV özeti' : 'VAT summary',       calistir: handlePullKdv },
      // En son: ürün başına bir Mikro çağrısı yapar, arka planda sürer.
      { ad: t ? 'Stok miktarları' : 'Stock qty',   calistir: handleStartMiktar },
    ];

    for (const adim of adimlar) {
      setTumuAdim(adim.ad);
      try { await adim.calistir(); ok++; }
      catch { hata++; }   // adım kendi hatasını zaten kartında gösteriyor
    }

    setTumuAdim(null);
    setTumuRunning(false);
    setTumuOzet({ ok, hata, bitti: true });
  }

  const extraPullDefs: { key: string; route: string; title: string; desc: string }[] = [
    { key: 'stok-miktar',  route: '/api/mikro/import/stok-miktar',    title: t ? 'Stok Miktarları (Depo)' : 'Stock Quantities (Depot)', desc: t ? 'Depo bazlı anlık miktarları çek; envanter ve depo kayıtlarını güncelle.' : 'Pull per-depot quantities; update inventory and warehouse records.' },
    { key: 'siparis',      route: '/api/mikro/import/siparis',        title: t ? 'Siparişler' : 'Orders',                desc: t ? 'Mikro\'daki satış siparişlerini çek.' : 'Pull sales orders from Mikro.' },
    { key: 'fatura',       route: '/api/mikro/import/fatura-listesi', title: t ? 'Faturalar' : 'Invoices',               desc: t ? 'Mikro\'da kesilen faturaları çek.' : 'Pull invoices issued in Mikro.' },
    { key: 'stok-hareket', route: '/api/mikro/import/stok-hareket',   title: t ? 'Stok Hareketleri' : 'Stock Movements', desc: t ? 'Stok giriş/çıkış hareketlerini çek.' : 'Pull stock in/out movements.' },
    { key: 'banka',        route: '/api/mikro/import/banka',          title: t ? 'Bankalar' : 'Banks',                   desc: t ? 'Banka hesap tanımlarını çek.' : 'Pull bank account definitions.' },
    { key: 'kasa',         route: '/api/mikro/import/kasa',           title: t ? 'Kasalar' : 'Cash Registers',           desc: t ? 'Kasa tanımlarını çek.' : 'Pull cash register definitions.' },
    { key: 'barkod',       route: '/api/mikro/import/barkod',         title: t ? 'Barkodlar' : 'Barcodes',               desc: t ? 'Barkodları çek ve ürünlere eşle.' : 'Pull barcodes and map to products.' },
    // Depo tanımları — uç 2026-07-31'de eklendi ama BU LİSTEYE eklenmemişti,
    // yani düğmesi hiç görünmedi ve kullanıcı "çekmemişsin" dedi. Haklıydı.
    { key: 'depo',         route: '/api/mikro/import/depo',           title: t ? 'Depo Tanımları' : 'Warehouses',        desc: t ? 'Mikro depo tanımlarını çek (Depo Tanımları ekranını doldurur).' : 'Pull warehouse definitions from Mikro.' },
    { key: 'odeme-plan',   route: '/api/mikro/import/odeme-plan',     title: t ? 'Ödeme Planları' : 'Payment Plans',     desc: t ? 'Ödeme planı tanımlarını çek.' : 'Pull payment plan definitions.' },
  ];

  // ── Dummy ürün temizliği (kaynaksız seed kayıtları) ─────────────────────────
  const [cleanupState, setCleanupState] = useState<{
    running: boolean; pendingCount: number | null; sample: string[]; result: string | null; error: string | null;
  }>({ running: false, pendingCount: null, sample: [], result: null, error: null });

  async function handleCleanup(confirm: boolean) {
    setCleanupState(s => ({ ...s, running: true, error: null }));
    try {
      const r = await fetch('/api/admin/cleanup-dummy-inventory', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ dryRun: !confirm }),
      });
      const d = await r.json() as { success: boolean; dummyCount?: number; deleted?: number; sample?: string[]; kept?: Record<string, number>; error?: string };
      if (!d.success) throw new Error(d.error || 'Hata');
      if (!confirm) {
        setCleanupState({ running: false, pendingCount: d.dummyCount ?? 0, sample: d.sample ?? [], result: null, error: null });
      } else {
        const keptStr = Object.entries(d.kept ?? {}).map(([s, n]) => `${s}: ${n}`).join(', ');
        setCleanupState({ running: false, pendingCount: null, sample: [],
          result: `${d.deleted ?? 0} ${t ? 'dummy ürün silindi' : 'dummy items deleted'}${keptStr ? ` · ${t ? 'korunan' : 'kept'}: ${keptStr}` : ''}`, error: null });
      }
    } catch (e) {
      setCleanupState(s => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Connection Status Card ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1a3a5c]/10 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-[#1a3a5c]" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900">
                {t ? 'Mikro Jump Bağlantı Durumu' : 'Mikro Jump Connection Status'}
              </h3>
              <p className="text-[11px] text-gray-400">
                {status?.mode === 'local'
                  ? (t ? 'localhost:8094 — sunucuda kurulu Jump (lokal)' : 'localhost:8094 — on-server Jump (local)')
                  : status?.mode === 'cloud' ? 'jumpbulutapigw.mikro.com.tr' : (status?.apiBase ?? '…')}
              </p>
            </div>
          </div>
          <button
            onClick={checkStatus}
            disabled={checkingStatus}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
            title={t ? 'Yenile' : 'Refresh'}
          >
            <RefreshCw className={`w-4 h-4 text-gray-500 ${checkingStatus ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {status ? (
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge ok={status.configured} label={t ? 'Yapılandırıldı' : 'Configured'} />
            <StatusBadge ok={status.connected}  label={t ? 'Bağlı' : 'Connected'} />
            {status.error && (
              <span className="text-[11px] text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {status.error}
              </span>
            )}
            {!status.configured && (
              <p className="text-[11px] text-gray-400 w-full mt-1">
                {status.message || (status.mode === 'local'
                  ? (t ? 'Lokal Jump modu: sunucu .env\'inde MIKRO_FIRMA_KODU + MIKRO_CALISMA_YILI + MIKRO_API_KEY ayarlayın (IDM/Alias gerekmez).'
                       : 'Local Jump mode: set MIKRO_FIRMA_KODU + MIKRO_CALISMA_YILI + MIKRO_API_KEY in server .env (no IDM/Alias needed).')
                  : (t ? 'Mikro env değişkenlerini sunucuda ayarlayın (MIKRO_IDM_EMAIL, MIKRO_IDM_PASSWORD, MIKRO_API_KEY, MIKRO_ALIAS)'
                       : 'Set Mikro env vars on the server (MIKRO_IDM_EMAIL, MIKRO_IDM_PASSWORD, MIKRO_API_KEY, MIKRO_ALIAS)'))}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t ? 'Kontrol ediliyor...' : 'Checking...'}
          </div>
        )}
      </div>

      {/* ── Retry Kuyruğu (başarısız push'lar otomatik yeniden denenir) ── */}
      {queueStats && (queueStats.queued > 0 || queueStats.dead > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-4 h-4 text-amber-500" />
            <div className="text-sm">
              <span className="font-semibold text-gray-800">{t ? 'Retry Kuyruğu' : 'Retry Queue'}</span>
              <span className="text-gray-500 ml-2">
                {queueStats.queued} {t ? 'bekliyor' : 'queued'}
                {queueStats.dead > 0 && <span className="text-red-500"> · {queueStats.dead} {t ? 'ölü' : 'dead'}</span>}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { setQueueBusy(true); try { await processMikroRetries(); } finally { await refreshQueue(); setQueueBusy(false); } }}
              disabled={queueBusy}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c]/20 transition-colors disabled:opacity-50"
            >
              {queueBusy ? (t ? 'Deneniyor…' : 'Retrying…') : (t ? 'Şimdi Dene' : 'Retry Now')}
            </button>
            {queueStats.dead > 0 && (
              <button
                onClick={async () => { setQueueBusy(true); try { await clearDeadJobs(); } finally { await refreshQueue(); setQueueBusy(false); } }}
                disabled={queueBusy}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {t ? 'Ölüleri Temizle' : 'Clear Dead'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Import Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Stok Import */}
        <ImportCard
          icon={<Package className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-50"
          title={t ? 'Stok İçeri Al' : 'Import Stock'}
          description={t
            ? 'Mikro\'daki tüm stok kartlarını Cetpa envanterine aktar. Mevcut ürünler güncellenir, yeniler oluşturulur.'
            : 'Import all Mikro stock cards into Cetpa inventory. Existing products updated, new ones created.'}
          buttonLabel={t ? 'Stokları İçeri Al' : 'Import All Stock'}
          buttonColor="bg-blue-600 hover:bg-blue-700"
          running={stokImport.running}
          result={stokImport.result}
          error={stokImport.error}
          disabled={!status?.connected}
          onImport={handleImportStok}
          lang={currentLanguage}
        />

        {/* Cari Import */}
        <ImportCard
          icon={<Users className="w-5 h-5 text-purple-600" />}
          iconBg="bg-purple-50"
          title={t ? 'Cari İçeri Al' : 'Import Customers'}
          description={t
            ? 'Mikro\'daki tüm cari hesapları (müşteri & tedarikçi) Cetpa\'ya aktar. Mevcut kayıtlar güncellenir.'
            : 'Import all Mikro cari accounts (customers & suppliers) into Cetpa. Existing records updated.'}
          buttonLabel={t ? 'Carileri İçeri Al' : 'Import All Customers'}
          buttonColor="bg-purple-600 hover:bg-purple-700"
          running={cariImport.running}
          result={cariImport.result}
          error={cariImport.error}
          disabled={!status?.connected}
          onImport={handleImportCari}
          lang={currentLanguage}
        />
      </div>

      {/* ── Stok Miktarları (GenelAmacliMaliyetListesiV2 — SKU başına) ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="font-bold text-sm text-gray-900">{t ? 'Stok Miktarlarını Çek' : 'Pull Stock Quantities'}</h4>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {t
                ? 'Mikro stok listesi miktar içermez — miktarlar SKU başına maliyet servisinden çekilir (1700+ ürün ≈ 3-6 dk, arka planda çalışır). Birim maliyet de güncellenir.'
                : 'Mikro stock list has no quantities — pulled per-SKU from the cost service (runs in background). Unit cost updated too.'}
            </p>
          </div>
          <button
            onClick={handleStartMiktar}
            disabled={miktarStarting || miktarJob?.running || !status?.connected}
            className="apple-button-primary text-xs px-4 py-2 disabled:opacity-50"
            style={{ background: '#1a3a5c' }}
          >
            {miktarJob?.running ? (t ? 'Çalışıyor…' : 'Running…') : miktarStarting ? '…' : (t ? 'Miktarları Çek' : 'Pull Quantities')}
          </button>
        </div>
        {miktarJob && (miktarJob.running || miktarJob.processed) ? (
          <div className="space-y-1.5">
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${miktarJob.running ? 'bg-[#1a3a5c]' : 'bg-emerald-500'}`}
                style={{ width: `${miktarJob.total ? Math.round(((miktarJob.processed ?? 0) / miktarJob.total) * 100) : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500">
              {miktarJob.processed ?? 0}/{miktarJob.total ?? '?'} {t ? 'işlendi' : 'processed'} · ✓ {miktarJob.updated ?? 0} {t ? 'güncellendi' : 'updated'}
              {(miktarJob.failed ?? 0) > 0 && <span className="text-amber-600"> · ⚠ {miktarJob.failed} {t ? 'hata' : 'failed'}</span>}
              {!miktarJob.running && <span className="text-emerald-600 font-semibold"> · {t ? 'tamamlandı' : 'done'}</span>}
            </p>
          </div>
        ) : null}
        {miktarJob?.error && <p className="text-[11px] text-red-600 bg-red-50 rounded-xl px-3 py-2">⚠ {miktarJob.error}</p>}
      </div>

      {/* ── Gelen e-Fatura GİB Onay / Red ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div>
          <h4 className="font-bold text-sm text-gray-900">{t ? 'Gelen e-Faturalar — GİB Onay / Red' : 'Incoming e-Invoices — Accept / Reject'}</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {t
              ? 'Mikro\'ya gelen e-faturaları GİB üzerinden kabul veya reddeder (GelenFaturalarKabulV2 / GelenFaturalarRedV2). Faturalar "Faturaları Çek" ile önce Mikro\'dan çekilmelidir.'
              : 'Accept or reject incoming e-invoices via GİB through Mikro. Invoices must first be pulled via "Pull Invoices".'}
          </p>
        </div>
        {gelenFaturalar.length === 0 ? (
          <p className="text-[11px] text-gray-400 bg-gray-50 rounded-xl px-3 py-2">
            {t ? 'Henüz gelen fatura yok. "Ekstra Çekme" bölümünden "Faturalar" çekmeyi deneyin.' : 'No incoming invoices yet. Try pulling "Invoices" from the Extra Pulls section.'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {gelenFaturalar.map(f => {
              const guid = f.cha_Guid || f.id;
              const no   = [f.cha_evrakno_seri, f.cha_evrakno_sira].filter(Boolean).join('-') || f.id.slice(0, 8);
              const act  = gibAction[f.id];
              const done = f.gibDurumu === 'kabul' || f.gibDurumu === 'ret';
              return (
                <div key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-gray-800">{no}</span>
                    {f.cha_kod && <span className="text-[11px] text-gray-400 ml-2">{f.cha_kod}</span>}
                    {f.cha_tarihi && <span className="text-[10px] text-gray-400 ml-2">{String(f.cha_tarihi).slice(0, 10)}</span>}
                    {f.cha_meblag != null && <span className="text-[10px] font-semibold text-gray-700 ml-2">{Number(f.cha_meblag).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>}
                    {done && (
                      <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${f.gibDurumu === 'kabul' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {f.gibDurumu === 'kabul' ? (t ? 'Kabul edildi' : 'Accepted') : (t ? 'Reddedildi' : 'Rejected')}
                      </span>
                    )}
                    {act?.error && <p className="text-[10px] text-red-600 mt-0.5">⚠ {act.error}</p>}
                  </div>
                  {!done && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleGibKabul(f.id, guid)}
                        disabled={act?.running || !status?.connected}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-emerald-600 text-white disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                      >
                        {act?.running ? '…' : (t ? 'Kabul' : 'Accept')}
                      </button>
                      <button
                        onClick={() => { setRetModal({ id: f.id, guid }); setRetAciklama(''); }}
                        disabled={act?.running || !status?.connected}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-red-500 text-white disabled:opacity-50 hover:bg-red-600 transition-colors"
                      >
                        {t ? 'Reddet' : 'Reject'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ret açıklama modalı */}
      {retModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRetModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4 z-10">
            <h3 className="font-bold text-gray-900">{t ? 'Fatura Reddet' : 'Reject Invoice'}</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t ? 'Red açıklaması' : 'Rejection reason'}</label>
              <textarea
                value={retAciklama}
                onChange={e => setRetAciklama(e.target.value)}
                rows={3}
                placeholder={t ? 'Açıklama girin…' : 'Enter reason…'}
                className="w-full text-sm bg-gray-50 rounded-xl px-3 py-2 outline-none resize-none border border-gray-200 focus:border-gray-400"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setRetModal(null)} className="flex-1 apple-button-secondary text-sm py-2">
                {t ? 'İptal' : 'Cancel'}
              </button>
              <button
                onClick={() => handleGibRet(retModal.id, retModal.guid, retAciklama || (t ? 'Fatura reddedildi.' : 'Invoice rejected.'))}
                className="flex-1 text-sm font-semibold py-2 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                {t ? 'Reddet' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── API kapsamı notu ── */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          {t
            ? 'ℹ️ Mikro JumpBulut API\'si şu işlemleri destekler: stok listesi/kaydı, cari listesi/kaydı, sipariş, e-fatura/irsaliye kaydı, gelen fatura GİB kabul/ret. Banka, kasa, barkod, ödeme planı, stok hareketi, sipariş/fatura listesi ve cari bakiye servisleri API\'de bulunmuyor (gateway doğrulandı) — bu veriler yalnızca Mikro masaüstünde yönetilir.'
            : 'ℹ️ The Mikro JumpBulut API supports: stock list/save, customer list/save, order, e-invoice/dispatch note save, incoming invoice GİB accept/reject. Bank, cash register, barcode, payment plan, stock movement, order/invoice list and balance services do not exist in the API (gateway verified).'}
        </p>
      </div>

      {/* ── Dummy Ürün Temizliği ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="font-bold text-sm text-gray-900">
              {t ? 'Dummy Ürün Temizliği' : 'Dummy Product Cleanup'}
            </h4>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {t
                ? 'Kaynağı olmayan örnek/seed ürünleri siler. Mikro, Shopify, CSV ve manuel eklenen ürünler korunur.'
                : 'Deletes seed products with no source. Mikro, Shopify, CSV and manually added products are kept.'}
            </p>
          </div>
          {cleanupState.pendingCount === null ? (
            <button
              onClick={() => handleCleanup(false)}
              disabled={cleanupState.running}
              className="apple-button-secondary text-xs px-4 py-2 disabled:opacity-50"
            >
              {cleanupState.running ? (t ? 'Sayılıyor…' : 'Counting…') : (t ? 'Dummy Ürünleri Say' : 'Count Dummy Items')}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCleanupState(s => ({ ...s, pendingCount: null, sample: [] }))}
                className="apple-button-secondary text-xs px-4 py-2"
              >
                {t ? 'Vazgeç' : 'Cancel'}
              </button>
              <button
                onClick={() => handleCleanup(true)}
                disabled={cleanupState.running || cleanupState.pendingCount === 0}
                className="text-xs px-4 py-2 rounded-full font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50"
              >
                {cleanupState.running
                  ? (t ? 'Siliniyor…' : 'Deleting…')
                  : (t ? `${cleanupState.pendingCount} Ürünü Sil` : `Delete ${cleanupState.pendingCount} Items`)}
              </button>
            </div>
          )}
        </div>
        {cleanupState.pendingCount !== null && cleanupState.sample.length > 0 && (
          <p className="text-[11px] text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
            {t ? 'Örnek' : 'Sample'}: {cleanupState.sample.join(', ')}{cleanupState.pendingCount > cleanupState.sample.length ? '…' : ''}
          </p>
        )}
        {cleanupState.result && (
          <p className="text-[11px] text-green-700 bg-green-50 rounded-xl px-3 py-2">✓ {cleanupState.result}</p>
        )}
        {cleanupState.error && (
          <p className="text-[11px] text-red-600 bg-red-50 rounded-xl px-3 py-2">⚠ {cleanupState.error}</p>
        )}
      </div>

      {/* ── Muhasebe Verisi Çek (Bakiye / Mizan / KDV) ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#1a3a5c]" />
            {t ? 'Muhasebe Verisi Çek' : 'Pull Accounting Data'}
          </h4>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-[11px] text-gray-500">
              {t ? 'Dönem (Mizan/KDV):' : 'Period (Trial/VAT):'}
              <input type="month" value={pullPeriod} onChange={e => setPullPeriod(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-[#1a3a5c]" />
            </label>
            {/* Tümünü Çek — adımlar sırayla koşar (Mikro tek servis, eşzamanlı
                yükte çökebiliyor). Bir adım patlarsa kalanlar devam eder. */}
            <button
              onClick={handleTumunuCek}
              disabled={tumuRunning}
              title={t ? 'Tüm Mikro verilerini sırayla çeker' : 'Pulls all Mikro data sequentially'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a3a5c] text-white text-xs font-semibold hover:bg-[#16324f] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${tumuRunning ? 'animate-spin' : ''}`} />
              {tumuRunning
                ? (t ? `Çekiliyor: ${tumuAdim ?? '...'}` : `Pulling: ${tumuAdim ?? '...'}`)
                : (t ? 'Tümünü Çek' : 'Pull All')}
            </button>
            <button
              onClick={handleHamSatirTemizle}
              disabled={temizlikRunning || tumuRunning}
              title="Banka/Kasa/Depo koleksiyonlarına yanlışlıkla yazılmış ham Mikro satırlarını siler (elle girilenlere dokunmaz)"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60 transition-colors"
            >
              {temizlikRunning ? 'Temizleniyor…' : 'Ham Satır Temizliği'}
            </button>
          </div>
        </div>

        {temizlikSonuc && (
          <div className="mb-4 px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800">
            {temizlikSonuc}
          </div>
        )}
        {tumuOzet?.bitti && (
          <div className={`mb-4 px-3 py-2 rounded-xl text-xs font-medium ${tumuOzet.hata > 0 ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
            {t
              ? `Bitti — ${tumuOzet.ok} adım tamam${tumuOzet.hata > 0 ? `, ${tumuOzet.hata} adım hatalı (ayrıntı ilgili kartta)` : ''}. Stok miktarları arka planda sürüyor olabilir.`
              : `Done — ${tumuOzet.ok} steps OK${tumuOzet.hata > 0 ? `, ${tumuOzet.hata} failed (see the card)` : ''}. Stock quantities may still be running.`}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <PullCard
            icon={<Users className="w-4 h-4 text-[#1a3a5c]" />}
            title={t ? 'Cari Bakiyeler' : 'Account Balances'}
            description={t ? 'Mikro cari bakiyelerini CRM müşterilerine işler.' : 'Sync Mikro account balances into CRM customers.'}
            state={bakiyePull} disabled={!status?.configured} onPull={handlePullBakiye} lang={t}
          />
          <PullCard
            icon={<Activity className="w-4 h-4 text-[#1a3a5c]" />}
            title={t ? 'Mizan' : 'Trial Balance'}
            description={t ? 'Seçili dönem mizanını çeker (hesap bazlı borç/alacak).' : 'Pull the trial balance for the selected period.'}
            state={mizanPull} disabled={!status?.configured} onPull={handlePullMizan} lang={t}
          />
          <PullCard
            icon={<Download className="w-4 h-4 text-[#1a3a5c]" />}
            title={t ? 'KDV Özeti' : 'VAT Summary'}
            description={t ? 'Seçili dönem KDV matrahı ve hesaplanan KDV.' : 'VAT base and calculated VAT for the period.'}
            state={kdvPull} disabled={!status?.configured} onPull={handlePullKdv} lang={t}
          />
        </div>

        {/* Diğer Mikro listeleri (genel import endpoint'leri) */}
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mt-5 mb-3">{t ? 'Diğer Mikro Listeleri' : 'Other Mikro Lists'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {extraPullDefs.map(def => (
            <PullCard
              key={def.key}
              icon={<Package className="w-4 h-4 text-[#1a3a5c]" />}
              title={def.title}
              description={def.desc}
              state={extraPulls[def.key] ?? { running: false, result: null, error: null }}
              disabled={!status?.configured}
              onPull={() => handleExtraPull(def.key, def.route)}
              lang={t}
            />
          ))}
        </div>
      </div>

      {/* ── Sync Log ── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowLog(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-bold text-gray-700">
              {t ? 'Senkronizasyon Geçmişi' : 'Sync History'}
              {syncLog.length > 0 && (
                <span className="ml-2 text-[11px] font-medium text-gray-400">({syncLog.length} kayıt)</span>
              )}
            </span>
          </div>
          {showLog ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showLog && (
          <div className="border-t border-gray-100 overflow-x-auto">
            {syncLog.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">
                {t ? 'Henüz senkronizasyon kaydı yok.' : 'No sync records yet.'}
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] w-32">
                      {t ? 'Zaman' : 'Time'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">
                      {t ? 'İşlem' : 'Operation'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">
                      {t ? 'Varlık' : 'Entity'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">
                      {t ? 'Mikro Ref.' : 'Mikro Ref.'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-center">
                      {t ? 'Durum' : 'Status'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-right">
                      {t ? 'Süre' : 'Duration'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {syncLog.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                        {entry.timestamp?.toDate
                          ? format(entry.timestamp.toDate(), 'dd.MM HH:mm:ss', { locale: tr })
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <OpBadge op={entry.operation} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        <span className="font-medium">{entry.entityType}</span>
                        {entry.entityId !== 'bulk' && entry.entityId !== 'unknown' && (
                          <span className="text-gray-300 ml-1">/{entry.entityId.substring(0, 8)}</span>
                        )}
                        {entry.entityId === 'bulk' && (
                          <span className="ml-1 text-[10px] text-teal-500 font-bold">BULK</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-[10px]">
                        {entry.mikroRef || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {entry.success
                          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                          : (
                            <span title={entry.error || ''}>
                              <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                            </span>
                          )
                        }
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-400">
                        {entry.duration ? `${entry.duration}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ImportCard sub-component ──────────────────────────────────────────────────

interface ImportCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  buttonLabel: string;
  buttonColor: string;
  running: boolean;
  result: MikroImportResult | null;
  error: string | null;
  disabled: boolean;
  onImport: () => void;
  lang: string;
}

function ImportCard({
  icon, iconBg, title, description, buttonLabel, buttonColor,
  running, result, error, disabled, onImport, lang,
}: ImportCardProps) {
  const t = lang === 'tr';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 flex flex-col">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center`}>
          {icon}
        </div>
        <h4 className="font-bold text-sm text-gray-900">{title}</h4>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed flex-1">{description}</p>

      {/* Result banner */}
      {result && !running && (
        <div className={`rounded-xl p-3 text-xs space-y-1 ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-1 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t ? 'İçeri aktarma tamamlandı' : 'Import complete'}
              </div>
              <div className="flex gap-4 text-[11px] mt-1">
                <span>🆕 {t ? 'Oluşturuldu' : 'Created'}: <b>{result.created}</b></span>
                <span>🔄 {t ? 'Güncellendi' : 'Updated'}: <b>{result.updated}</b></span>
                {result.errors > 0 && <span>⚠️ {t ? 'Hata' : 'Errors'}: <b>{result.errors}</b></span>}
                {result.duration && <span>⏱ {Math.round(result.duration / 1000)}s</span>}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />
              <span className="font-bold">{t ? 'Hata: ' : 'Error: '}</span>
              {error}
            </div>
          )}
        </div>
      )}

      {error && !result && !running && (
        <div className="rounded-xl p-3 bg-red-50 text-red-600 text-xs flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={onImport}
        disabled={running || disabled}
        className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${buttonColor}`}
      >
        {running ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            {t ? 'Aktarılıyor...' : 'Importing...'}
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            {buttonLabel}
          </>
        )}
      </button>

      {disabled && !running && (
        <p className="text-[10px] text-center text-gray-400">
          {t ? 'Mikro bağlantısı gerekli' : 'Mikro connection required'}
        </p>
      )}
    </div>
  );
}

// ── PullCard sub-component ────────────────────────────────────────────────────

interface PullCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  state: PullState;
  disabled: boolean;
  onPull: () => void;
  lang: boolean;
}

function PullCard({ icon, title, description, state, disabled, onPull, lang: t }: PullCardProps) {
  return (
    <div className="border border-gray-100 rounded-xl p-4 space-y-3 flex flex-col">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-gray-50 rounded-lg flex items-center justify-center">
          {icon}
        </div>
        <h5 className="font-bold text-xs text-gray-800">{title}</h5>
      </div>
      <p className="text-[11px] text-gray-400 flex-1">{description}</p>

      {state.result && !state.running && (
        <div className="rounded-lg p-2 bg-green-50 text-green-700 text-[11px] flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> {state.result}
        </div>
      )}
      {state.error && !state.running && (
        <div className="rounded-lg p-2 bg-red-50 text-red-600 text-[11px] flex items-center gap-1.5">
          <XCircle className="w-3 h-3 flex-shrink-0" /> {state.error}
        </div>
      )}

      <button
        onClick={onPull}
        disabled={state.running || disabled}
        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state.running
          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin"/>{t ? 'Çekiliyor…' : 'Pulling…'}</>
          : <><Download className="w-3.5 h-3.5"/>{t ? 'Çek' : 'Pull'}</>}
      </button>
    </div>
  );
}
