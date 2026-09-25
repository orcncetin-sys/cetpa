import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Download,
  Package, Users, Activity, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { collection, query, where, limit, orderBy, onSnapshot } from '../lib/dbClient';
import { db, auth } from '../firebase';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { getMikroStatus, mikroImportBaslat, MikroStatus } from '../services/mikroService';
import { mikroIsAdi } from '../lib/mikroIsAdi';
import { isAllowed } from '../lib/rbac';
import { useAppStore } from '../store/appStore';
import { isiBaslatVeBekle, IsZamanAsimiHatasi, BaskaIsKosuyorHatasi, type ArkaPlanIsi } from '../hooks/useArkaPlanIsi';
import { tumunuCekBaslat, useTumunuCek, SirayiDurdurHatasi, type TumunuCekAdimi } from '../hooks/useTumunuCek';
import ArkaPlanIsiKarti from './mikro/ArkaPlanIsiKarti';
import { sayiMetni, sonluSayi } from '../utils/sayiMetni';
import { getSyncQueueStats, clearDeadJobs } from '../services/syncRetryService';
import { processMikroRetries } from '../services/mikroEvrak';
import { paraYaz } from '../utils/currency';
import { ayAnahtari } from '../utils/zaman';

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
  /** Tanı ayrıntısı — `yanitAnahtarlari`: Mikro yanıtının yalnız ANAHTAR yolları (İkiz ölçümü I2; değer yok). */
  ayrinti?: { yanitAnahtarlari?: unknown };
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
  // Senkron Geçmişi rol kapısı (rbac.ts: syncLog okuma yalnız Admin/Manager). Sunucu yetkisiz koleksiyona
  // BOŞ init yollar, hata yollamaz → onSnapshot hata geri çağrısı hiç tetiklenmez ve ekran "Henüz kayıt yok"
  // derdi. Yetkisizlik ≠ boşluk: metin ayrılır; KURAL gevşetilmez (kullanıcı kararı, açık soru 1).
  const userRole = useAppStore(s => s.userRole);
  const gecmisOkunabilir = isAllowed(userRole, 'syncLog', 'read');

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

  // Pull-flow states
  const defaultPeriod = ayAnahtari(new Date()) ?? '';   // YEREL ay (toISOString UTC ayı verirdi: ayın 1'i 00:00-03:00 arası önceki ay) // YYYY-MM
  const [pullPeriod, setPullPeriod] = useState(defaultPeriod);
  const [bakiyePull, setBakiyePull] = useState<PullState>({ running: false, result: null, error: null });
  const [mizanPull,  setMizanPull]  = useState<PullState>({ running: false, result: null, error: null });
  const [kdvPull,    setKdvPull]    = useState<PullState>({ running: false, result: null, error: null });

  // ── Gelen e-Fatura Kabul / Ret ────────────────────────────────────────────
  interface GelenFatura { id: string; cha_Guid?: string; cha_evrakno_seri?: string; cha_evrakno_sira?: string; cha_tarihi?: string; cha_kod?: string; cha_meblag?: number; gibDurumu?: string; gibKabulAt?: unknown; gibRetAt?: unknown; gibRetAciklama?: string; }
  const [gelenFaturalar, setGelenFaturalar] = useState<GelenFatura[]>([]);
  const [gibAction, setGibAction] = useState<Record<string, { running: boolean; error: string | null }>>({});
  const [retModal, setRetModal] = useState<{ id: string; guid: string } | null>(null);
  const [retAciklama, setRetAciklama] = useState('');

  useEffect(() => {
    // Eski: `limit(50)` alip SONRA `.filter(yon === 'alis')` — hem sirasiz hem limit-sonrasi-suzme:
    // 50 rastgele faturanin icinden alislar seciliyordu, yeni gelen fatura listeye girmeyebiliyordu.
    // dbClient sirasi where -> orderBy -> limit (applyConstraints). 2026-09-24 hasimsal tur, E4 kardesi.
    const q = query(collection(db, 'mikroFaturalar'), where('yon', '==', 'alis'), orderBy('cha_tarihi', 'desc'), limit(50));
    const unsub = onSnapshot(q, snap => {
      setGelenFaturalar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<GelenFatura, 'id'>) })));
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
  // Okuma hatasi ARTIK SESSIZ DEGIL: onSnapshot'in hata geri cagrisi yoktu,
  // dolayisiyla yetki/ag hatasinda ekran "Henuz senkronizasyon kaydi yok."
  // gosteriyordu — yani "hic kayit yok" ile "kayitlari okuyamadim" ayirt
  // edilemiyordu (2026-08-18 kullanici sorusu: "gecmisi de mi sildik?").
  const [syncLogError, setSyncLogError] = useState<string | null>(null);
  useEffect(() => {
    const q = query(
      collection(db, 'syncLog'),
      // orderBy YOKTU: kayit olsa bile EN YENI 30 degil RASTGELE 30 geliyordu (2026-09-24 teshis, CONFIRMED).
      // ErpSyncPanel:119 ile ayni desen.
      orderBy('timestamp', 'desc'),
      limit(30)
    );
    const unsub = onSnapshot(
      q,
      snap => { setSyncLogError(null); setSyncLog(snap.docs.map(d => ({ id: d.id, ...d.data() } as SyncLogEntry))); },
      err => { console.error('[syncLog] okunamadi:', err); setSyncLogError(err instanceof Error ? err.message : String(err)); },
    );
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

  // ── Arka plan import adımı (Tümünü Çek) ─────────────────────────────────────
  // 14 import ucu (stok, cari, 12 SQL) + stok-miktar = 15 uç anında `{ started, job }` döner; adım işin
  // `jobs/<isAdi>` BİTİŞİNİ bekler (K-C global kilit: beklemeyen döngü 2. adımdan itibaren hepsine
  // `alreadyRunning` verirdi). İş adı TEK sözlükten.
  // İnceleme bulgusu 2026-09-25: (1) SQL işi sayfa tavanına çarptıysa (`truncated`) iş 'başarılı' biter ama
  // veri EKSİKTİR — özet eskiden onu 'tamam' sayıyordu; artık adım hatalı. (2) Bekleme tavanı dolarsa iş
  // sunucuda hâlâ sürüyor ve kilidi tutuyor → sıra DURUR (SirayiDurdurHatasi), kalan adımlar koşturulmaz.
  // (3) Aynısı 'başka bir iş çalışıyor' yanıtında (delta hakem 2026-09-25): elle başlatılmış bir iş koşarken
  // sıra sürseydi senkron adımlar onunla EŞZAMANLI Mikro'ya giderdi.
  const arkaPlanAdimi = (route: string): Promise<void> =>
    isiBaslatVeBekle(mikroIsAdi(route), () => mikroImportBaslat(route), { tr: t }).then(
      is => {
        if (is.truncated !== true) return;
        const sinir = typeof is.limit === 'number' && Number.isFinite(is.limit) ? is.limit : null;
        throw new Error(t
          ? `Sayfa tavanına çarptı — veri EKSİK${sinir !== null ? ` (yalnız ilk ${sinir.toLocaleString('tr-TR')} satır alındı)` : ''}`
          : `Hit the page cap — data INCOMPLETE${sinir !== null ? ` (only the first ${sinir.toLocaleString('en-US')} rows)` : ''}`);
      },
      (e: unknown) => {
        if (e instanceof IsZamanAsimiHatasi) {
          throw new SirayiDurdurHatasi(t
            ? `${e.message} — iş hâlâ sürüyor olabilir, sıra durduruldu`
            : `${e.message} — the job may still be running, queue stopped`);
        }
        if (e instanceof BaskaIsKosuyorHatasi) {
          throw new SirayiDurdurHatasi(t
            ? `${e.message.replace(/ — bitince deneyin\.$/, '')} — sıra durduruldu; o iş bitince Tümünü Çek'i yeniden başlatın`
            : `${e.message.replace(/ — try again when it finishes\.$/, '')} — queue stopped; restart Pull All when that job finishes`);
        }
        throw e;
      },
    );

  // ── Senkron adım (Tümünü Çek) ────────────────────────────────────────────────
  // Delta hakem 2026-09-25 (bulgu 10, yarım düzeltme): 7 senkron adım (4 senkron uç + bakiye/mizan/kdv)
  // hatayı KENDİ kartına yazıp resolve ediyordu → Tümünü Çek onları hep 'tamam' sayıyordu (pull/personel
  // HTML 502 → kart kırmızı, özet YEŞİL "22 adım tamam"). Handler'lar artık hata metnini DÖNDÜRÜR (kartın
  // onClick'i yok sayar — reddedilmiş söz sızmaz); Tümünü Çek'e TEK yerden, bu sarmalayıcıyla bağlanır.
  const senkronAdim = (calistir: () => Promise<string | null>) => async (): Promise<void> => {
    const hata = await calistir();
    if (hata !== null) throw new Error(hata);
  };
  const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // ── Pull-flow handlers ─────────────────────────────────────────────────────
  async function authHeaders(): Promise<Record<string, string>> {
    const token = await auth.currentUser?.getIdToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  /** Hata metni döner (başarıda null) — Tümünü Çek `senkronAdim` ile sayar; kart kendi state'inden okur. */
  async function handlePullBakiye(): Promise<string | null> {
    setBakiyePull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/bakiye', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({}) });
      // `note` KISMİ eksiği bildirir ("3 satırın bakiye alanı bilinmiyor"); bakiye HİÇ
      // okunamadıysa sunucu 502 + `error` döner ve aşağıdaki throw ile kırmızı görünür.
      const d = await r.json() as { success: boolean; updated?: number; skipped?: number; note?: string; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setBakiyePull({ running: false, result: `${t ? 'Güncellendi' : 'Updated'}: ${d.updated ?? 0} / ${t ? 'Atlandı' : 'Skipped'}: ${d.skipped ?? 0}${d.note ? ` · ${d.note}` : ''}`, error: null });
      return null;
    } catch (e) {
      setBakiyePull({ running: false, result: null, error: hataMetni(e) });
      return hataMetni(e);
    }
  }

  async function handlePullMizan(): Promise<string | null> {
    setMizanPull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/mizan', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ period: pullPeriod }) });
      // ALAN ADI: rota `rowCount` döndürür. Burası `d.rows` okuyordu → her başarılı
      // çekim "0 satır" yazıyordu (sessiz sıfırın EKRAN karşılığı, 2026-09-19'da bulundu).
      // `?? 0` BİLEREK kalıyor: `rowCount` artık her başarılı yanıtta dolu.
      const d = await r.json() as { success: boolean; period?: string; rowCount?: number; note?: string | null; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setMizanPull({ running: false, result: `${t ? 'Dönem' : 'Period'}: ${d.period ?? pullPeriod} · ${d.rowCount ?? 0} ${t ? 'satır' : 'rows'}` + (d.note ? ` · ${d.note}` : ''), error: null });
      return null;
    } catch (e) {
      setMizanPull({ running: false, result: null, error: hataMetni(e) });
      return hataMetni(e);
    }
  }

  async function handlePullKdv(): Promise<string | null> {
    setKdvPull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/kdv', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ period: pullPeriod }) });
      // `kdvMatrahi` artık null olabilir (hiçbir oran kovasının matrahı okunamadı) —
      // `paraYaz(null)` '—' basar. `note` GÖRÜNMEZSE düzeltme yarım kalır: sessiz
      // sıfırı sessiz EKSİĞE çevirmiş oluruz.
      const d = await r.json() as { success: boolean; period?: string; kdvMatrahi?: number | null; hesaplananKdv?: number; note?: string | null; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setKdvPull({ running: false, result: `${t ? 'Matrah' : 'Base'}: ${paraYaz(d.kdvMatrahi, { ondalik: 0 })} · KDV: ${paraYaz(d.hesaplananKdv, { ondalik: 0 })}` + (d.note ? ` · ${d.note}` : ''), error: null });
      return null;
    } catch (e) {
      setKdvPull({ running: false, result: null, error: hataMetni(e) });
      return hataMetni(e);
    }
  }

  // ── Diğer Mikro listeleri — YALNIZ 4 senkron uç (faturadan-siparis, pull/personel, pull/uretim-receteleri,
  // pull/cari-adres) buradan koşar; 12 SQL import ucu `arkaPlan` bayrağıyla ArkaPlanIsiKarti'na bağlı.
  const [extraPulls, setExtraPulls] = useState<Record<string, PullState>>({});
  async function handleExtraPull(key: string, route: string): Promise<string | null> {
    setExtraPulls(p => ({ ...p, [key]: { running: true, result: null, error: null } }));
    try {
      const r = await fetch(route, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({}) });
      const d = await r.json() as { success: boolean; total?: number; note?: string | null; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setExtraPulls(p => ({ ...p, [key]: {
        running: false,
        result: `${sayiMetni(d.total)} ${t ? 'kayıt' : 'records'}${d.note ? ` · ${d.note}` : ''}`,
        error: null,
      } }));
      return null;
    } catch (e) {
      setExtraPulls(p => ({ ...p, [key]: { running: false, result: null, error: hataMetni(e) } }));
      return hataMetni(e);
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

  // Sıra durumu MODÜL düzeyinde (src/hooks/useTumunuCek.ts, delta bulgu 9): panel kapanıp açılınca sürmekte
  // olan sıra görünür, ikinci döngü başlamaz (senkron uçlar birincinin koşan işiyle eşzamanlı gitmez).
  const tumu = useTumunuCek();

  function handleTumunuCek() {
    // Sıra bilinçli: önce kart/tanım verisi, sonra hareket verisi, en son
    // en uzun iş (stok miktarı) — o bittiğinde diğerleri hazır olur.
    // Arka plan adımları (stok, cari, 12 SQL, miktar) `arkaPlanAdimi` ile BİTİŞİ BEKLER; elle başlatılmış
    // BAŞKA bir iş koşuyorsa ya da bekleme tavanı dolarsa sıra DURUR (kalan adımlar koşturulmaz — senkron
    // adımlar koşan işle eşzamanlı Mikro'ya gitmesin). Diğer hatalar özete yazılır, sıra sürer. Senkron
    // adımlar `senkronAdim` ile: hata metinleri de özete girer (delta bulgu 10).
    const adimlar: TumunuCekAdimi[] = [
      { ad: t ? 'Stok kartları' : 'Stock cards',   calistir: () => arkaPlanAdimi('/api/mikro/import/stok') },
      { ad: t ? 'Cariler' : 'Customers',           calistir: () => arkaPlanAdimi('/api/mikro/import/cari') },
      // Faturadan sipariş, stok hareketlerinden SONRA (inceleme 2026-09-25, CONFIRMED): kalemleri artık o hareketlerden
      // yazılıyor; önce koşarsa bugünün faturasının siparişi kalemsiz türerdi.
      ...[...extraPullDefs.filter(d => d.key !== 'faturadan-siparis'), ...extraPullDefs.filter(d => d.key === 'faturadan-siparis')].map(d => ({
        ad: d.title,
        calistir: d.arkaPlan ? () => arkaPlanAdimi(d.route) : senkronAdim(() => handleExtraPull(d.key, d.route)),
      })),
      { ad: t ? 'Cari bakiyeler' : 'Balances',     calistir: senkronAdim(handlePullBakiye) },
      { ad: t ? 'Mizan' : 'Trial balance',         calistir: senkronAdim(handlePullMizan) },
      { ad: t ? 'KDV özeti' : 'VAT summary',       calistir: senkronAdim(handlePullKdv) },
      // En son: ürün başına bir Mikro çağrısı yapar; artık bitişi beklenir.
      { ad: t ? 'Stok miktarları' : 'Stock qty',   calistir: () => arkaPlanAdimi('/api/mikro/import/stok-miktar') },
    ];
    // Hata metni sıra İÇİNDE toplanır ve özette basılır. Arka plan kartının `baslatmaHatasi` state'i yalnız
    // KENDİ düğmesiyle dolar — Tümünü Çek'in başlatma hatasını (423 bakım kilidi, 'Başka bir iş çalışıyor',
    // HTTP 502, 403) kart GÖRMEZ. Eskiden özet kullanıcıyı karta yönlendiriyordu, kartta ise önceki koşunun
    // yeşil "tamamlandı" satırı duruyordu (hakem bulgusu 2026-09-25; 2026-08-28'de düzeltilen "başlatılamadı
    // ile önceki koşu karışıyor" arızasının aynısı). Zaten koşuyorsa `null` döner — ikinci döngü YOK.
    // Oturum değişirse (çıkış / başka kullanıcı) sıra kalan adımları KOŞTURMAZ (inceleme bulgusu 2026-09-25).
    void tumunuCekBaslat(adimlar, { kimlik: () => auth.currentUser?.uid ?? null });
  }

  // NOT: 'stok-miktar' bilerek BURADA YOK. Aynı uç yukarıdaki "Stok Miktarlarını
  // Çek" kartında sunuluyor; iki düğmede görünmesin. (Eskiden jenerik kart yanıltıcıydı:
  // uç arka plan işi başlatıp hemen döndüğü için kart işi "bitti" sanıyordu — artık
  // 12 SQL ucu da aynı ArkaPlanIsiKarti bileşeni: `arkaPlan` bayrağı → iş adı
  // mikroIsAdi(route), ilerleme jobs/<isAdi>'dan; `key` iş adı DEĞİLDİR ('fatura' ≠ 'fatura-listesi').)
  // 4 senkron uç (arkaPlan yok) PullCard + handleExtraPull ile kalır (bu tur dışı, 502 sınıfında).
  const extraPullDefs: { key: string; route: string; title: string; desc: string; arkaPlan?: true }[] = [
    { key: 'siparis',      route: '/api/mikro/import/siparis', arkaPlan: true,        title: t ? 'Siparişler' : 'Orders',                desc: t ? 'Mikro\'daki satış siparişlerini çek.' : 'Pull sales orders from Mikro.' },
    { key: 'fatura',       route: '/api/mikro/import/fatura-listesi', arkaPlan: true, title: t ? 'Faturalar' : 'Invoices',               desc: t ? 'Mikro\'da kesilen faturaları çek.' : 'Pull invoices issued in Mikro.' },
    // 2026-09-25: iptal edilen faturalar AYRI koleksiyona iner; hiçbir hesap okumaz, yalnız CRM → İptal & İade listesi.
    { key: 'iptal-fatura', route: '/api/mikro/import/iptal-faturalar', arkaPlan: true, title: t ? 'İptal Edilen Faturalar' : 'Cancelled Invoices', desc: t ? 'Mikro\'da iptal edilen faturaları çek (İptal & İade listesinde görünür, hesaplara girmez).' : 'Pull invoices cancelled in Mikro (shown on Cancellations & Returns, excluded from all totals).' },
    // 2026-09-01 kullanıcı isteği: "faturası kesilen her şeyin siparişi olmalı".
    // Önce Faturalar çekilmiş olmalı; idempotent (tekrar basmak kopya üretmez).
    { key: 'faturadan-siparis', route: '/api/mikro/import/faturadan-siparis', title: t ? 'Faturadan Sipariş Türet' : 'Derive Orders from Invoices', desc: t ? 'Her SATIŞ faturası için fatura tarihli bir Cetpa siparişi oluştur (kalemleriyle). Ciro kartları çift saymaz.' : 'Create a Cetpa order (with line items) for each sales invoice, dated by the invoice.' },
    { key: 'cari-hareket', route: '/api/mikro/import/cari-hareket', arkaPlan: true,   title: t ? 'Cari Hareketler (Tümü)' : 'Account Movements (All)', desc: t ? 'TÜM cari hareketleri çek (fatura + masraf + dekont + tahsilat + virman). Cari Ekstre bunu okur; fatura-olmayan hareketleri de gösterir.' : 'Pull ALL account movements (invoice + expense + note + collection + transfer). Feeds the Account Statement.' },
    { key: 'stok-hareket', route: '/api/mikro/import/stok-hareket', arkaPlan: true,   title: t ? 'Stok Hareketleri' : 'Stock Movements', desc: t ? 'Stok giriş/çıkış hareketlerini çek.' : 'Pull stock in/out movements.' },
    { key: 'banka',        route: '/api/mikro/import/banka', arkaPlan: true,          title: t ? 'Bankalar' : 'Banks',                   desc: t ? 'Banka hesap tanımlarını çek.' : 'Pull bank account definitions.' },
    { key: 'kasa',         route: '/api/mikro/import/kasa', arkaPlan: true,           title: t ? 'Kasalar' : 'Cash Registers',           desc: t ? 'Kasa tanımlarını çek.' : 'Pull cash register definitions.' },
    { key: 'barkod',       route: '/api/mikro/import/barkod', arkaPlan: true,         title: t ? 'Barkodlar' : 'Barcodes',               desc: t ? 'Barkodları çek ve ürünlere eşle.' : 'Pull barcodes and map to products.' },
    // Depo tanımları — uç 2026-07-31'de eklendi ama BU LİSTEYE eklenmemişti,
    // yani düğmesi hiç görünmedi ve kullanıcı "çekmemişsin" dedi. Haklıydı.
    { key: 'depo',         route: '/api/mikro/import/depo', arkaPlan: true,           title: t ? 'Depo Tanımları' : 'Warehouses',        desc: t ? 'Mikro depo tanımlarını çek (Depo Tanımları ekranını doldurur).' : 'Pull warehouse definitions from Mikro.' },
    { key: 'odeme-plan',   route: '/api/mikro/import/odeme-plan', arkaPlan: true,     title: t ? 'Ödeme Planları' : 'Payment Plans',     desc: t ? 'Ödeme planı tanımlarını çek.' : 'Pull payment plan definitions.' },
    // Bu iki uç 2026-08-11'e kadar SUNUCUDA VARDI ama hiçbir istemci çağırmıyordu
    // ve veriyi hiçbir koleksiyona yazmıyorlardı — İK ve Üretim ekranları bu
    // yüzden hep boştu. Artık employees / bom koleksiyonlarına yazıyorlar.
    // Fiyat DOĞRU kaynaktan: stok kartında `sto_satis_fiyat*` kolonu bu kurulumda
    // YOK (sema-kesif: "Invalid column name"), fiyatlar STOK_SATIS_FIYAT_LISTELERI'nde
    // ve 2075 üründe dolu. Ürünlerin "0 TL" görünmesinin nedeni buydu.
    { key: 'fiyat',        route: '/api/mikro/import/fiyat', arkaPlan: true,          title: t ? 'Satış Fiyatları' : 'Sale Prices',      desc: t ? 'Fiyat listesinden satış fiyatlarını çek ve ürünlere işle (0 TL sorununu çözer).' : 'Pull sale prices from the price list into products.' },
    { key: 'demirbas',     route: '/api/mikro/import/demirbas', arkaPlan: true,       title: t ? 'Demirbaşlar' : 'Fixed Assets',         desc: t ? 'Mikro demirbaş kartlarını çek (Sabit Kıymetler ekranını doldurur).' : 'Pull fixed asset records.' },
    { key: 'maliyet-mrk',  route: '/api/mikro/import/maliyet-merkezi', arkaPlan: true, title: t ? 'Maliyet Merkezleri' : 'Cost Centers', desc: t ? 'Mikro sorumluluk/maliyet merkezlerini çek.' : 'Pull responsibility/cost centers.' },
    { key: 'personel',     route: '/api/mikro/pull/personel',         title: t ? 'Personel' : 'Employees',               desc: t ? 'Mikro personel kartlarını çek (İK ekranını doldurur).' : 'Pull personnel records into HR.' },
    { key: 'recete',       route: '/api/mikro/pull/uretim-receteleri', title: t ? 'Üretim Reçeteleri' : 'BOM Recipes',   desc: t ? 'Üretim reçetelerini (BOM) çek (Üretim ekranını doldurur).' : 'Pull production recipes (BOM).' },
    // 2026-08-17: yalnız PUSH vardı (leads→Mikro), Mikro'daki cari adresleri
    // hiç geri gelmiyordu — Satış Bölgesi'nin şehir bazlı otomatik atama
    // yapabilmesi için şart (bkz. TerritoryModule cityInTerritory).
    { key: 'cari-adres',   route: '/api/mikro/pull/cari-adres',       title: t ? 'Cari Adresleri' : 'Account Addresses', desc: t ? 'Mikro cari adreslerini çek, yalnız boş şehir/adres alanlarını doldurur (Satış Bölgesi otomatik atama için).' : 'Pull Mikro account addresses, filling only empty city/address fields (feeds Territory auto-assignment).' },
  ];

  // ── MF sipariş kalemlerini yenile (2026-09-25) ───────────────────────────────
  // Faturadan-sipariş importu artık kalemleri kiracının stok hareketlerinden KDV hariç net + iskonto ile yazıyor (sürüm 2).
  // MEVCUT MF siparişlerinin (kalemsiz ya da eski biçimli) kalemi yalnız bu açık iki adımla yenilenir: önce önizle (sunucu
  // HİÇBİR ŞEY yazmaz), sonra uygula (yalnız lineItems; durum/not/sevkiyat dokunulmaz). Tümünü Çek bunu YAPMAZ.
  const [kalemYenile, setKalemYenile] = useState<{
    running: boolean; bekleyen: number | null; ornek: Array<{ orderNumber: string; eski: number; yeni: number }>;
    /** Önizlemenin sunucu notu (çözülemeyen kalem, azalan kalem, kaynaksız sipariş) — atılmaz, onaydan önce görünür. */
    not: string | null;
    sonuc: string | null; hata: string | null;
  }>({ running: false, bekleyen: null, ornek: [], not: null, sonuc: null, hata: null });

  async function handleKalemYenile(uygula: boolean) {
    setKalemYenile(s => ({ ...s, running: true, hata: null, sonuc: null }));
    try {
      const r = await fetch('/api/mikro/import/faturadan-siparis', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ kalemYenile: uygula ? 'uygula' : 'onizle' }),
      });
      const d = await r.json() as { success: boolean; error?: string; notConfigured?: boolean; note?: string | null;
        kalemYenilenecek?: number; kalemYenilenen?: number; kalemOrnek?: Array<{ orderNumber: string; eski: number; yeni: number }> };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || (t ? 'Hata' : 'Error'));
      if (!uygula) {
        const bekleyen = typeof d.kalemYenilenecek === 'number' && Number.isFinite(d.kalemYenilenecek) ? d.kalemYenilenecek : null;
        if (bekleyen === null) throw new Error(t ? 'Sunucu yenilenecek sipariş sayısını döndürmedi.' : 'Server did not return a count.');
        setKalemYenile({ running: false, bekleyen, ornek: d.kalemOrnek ?? [], not: d.note ?? null, sonuc: null, hata: null });
      } else {
        setKalemYenile({ running: false, bekleyen: null, ornek: [], not: null,
          sonuc: `${sayiMetni(d.kalemYenilenen)} ${t ? 'siparişin kalemi yenilendi' : 'orders updated'}${d.note ? ` · ${d.note}` : ''}`, hata: null });
      }
    } catch (e) {
      setKalemYenile(s => ({ ...s, running: false, hata: e instanceof Error ? e.message : String(e) }));
    }
  }

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

        {/* Stok Import — arka plan işi; ilerleme/sonuç jobs/mikroImport-stok */}
        <ArkaPlanIsiKarti
          isAdi={mikroIsAdi('/api/mikro/import/stok')}
          baslik={t ? 'Stok İçeri Al' : 'Import Stock'}
          aciklama={t
            ? 'Mikro\'daki tüm stok kartlarını Cetpa envanterine aktar. Mevcut ürünler güncellenir, yeniler oluşturulur.'
            : 'Import all Mikro stock cards into Cetpa inventory. Existing products updated, new ones created.'}
          dugmeMetni={t ? 'Stokları İçeri Al' : 'Import All Stock'}
          gorunum={{ icon: <Package className="w-5 h-5 text-blue-600" />, iconBg: 'bg-blue-50', buttonColor: 'bg-blue-600 hover:bg-blue-700' }}
          disabled={!status?.connected}
          baslat={() => mikroImportBaslat('/api/mikro/import/stok')}
          ekOzet={is => fiyatRehberi(is, t)}
          lang={currentLanguage}
        />

        {/* Cari Import — arka plan işi; jobs/mikroImport-cari */}
        <ArkaPlanIsiKarti
          isAdi={mikroIsAdi('/api/mikro/import/cari')}
          baslik={t ? 'Cari İçeri Al' : 'Import Customers'}
          aciklama={t
            ? 'Mikro\'daki tüm cari hesapları (müşteri & tedarikçi) Cetpa\'ya aktar. Mevcut kayıtlar güncellenir.'
            : 'Import all Mikro cari accounts (customers & suppliers) into Cetpa. Existing records updated.'}
          dugmeMetni={t ? 'Carileri İçeri Al' : 'Import All Customers'}
          gorunum={{ icon: <Users className="w-5 h-5 text-purple-600" />, iconBg: 'bg-purple-50', buttonColor: 'bg-purple-600 hover:bg-purple-700' }}
          disabled={!status?.connected}
          baslat={() => mikroImportBaslat('/api/mikro/import/cari')}
          lang={currentLanguage}
        />
      </div>

      {/* ── Stok Miktarları (GenelAmacliMaliyetListesiV2 — SKU başına) ── */}
      {/* jobs/stokMiktarImport — sözlük istisnası (mikroIsAdi), literal yazılmaz; doküman canlıda VAR. */}
      <ArkaPlanIsiKarti
        isAdi={mikroIsAdi('/api/mikro/import/stok-miktar')}
        baslik={t ? 'Stok Miktarlarını Çek' : 'Pull Stock Quantities'}
        aciklama={t
          ? 'Mikro stok listesi miktar içermez — miktarlar SKU başına maliyet servisinden çekilir (1700+ ürün ≈ 3-6 dk, arka planda çalışır). Birim maliyet de güncellenir.'
          : 'Mikro stock list has no quantities — pulled per-SKU from the cost service (runs in background). Unit cost updated too.'}
        dugmeMetni={t ? 'Miktarları Çek' : 'Pull Quantities'}
        disabled={!status?.connected}
        baslat={() => mikroImportBaslat('/api/mikro/import/stok-miktar')}
        ekOzet={is => depoDagilimi(is, t)}
        lang={currentLanguage}
      />

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
                    {f.cha_meblag != null && <span className="text-[10px] font-semibold text-gray-700 ml-2">{paraYaz(f.cha_meblag)}</span>}
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
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4 z-10 max-h-[90vh] overflow-y-auto">
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

      {/* ── MF sipariş kalemlerini yenile ── */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3" aria-label={t ? 'MF sipariş kalemlerini yenile' : 'Refresh MF order lines'}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="font-bold text-sm text-gray-900">{t ? 'MF Sipariş Kalemlerini Yenile' : 'Refresh MF Order Lines'}</h4>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {t
                ? 'Faturadan türeyen siparişlerin boş ya da eski biçimli kalemlerini Mikro stok hareketlerinden (KDV hariç net, iskonto ayrı) yeniden yazar. Durum, not ve sevkiyat değişmez. Önce "Stok Hareketleri"ni çekin.'
                : 'Rewrites empty or old-format lines of invoice-derived orders from Mikro stock movements (net excl. VAT, discount separate). Status, notes and shipments are unchanged. Pull stock movements first.'}
            </p>
          </div>
          {kalemYenile.bekleyen === null ? (
            <button onClick={() => handleKalemYenile(false)} disabled={kalemYenile.running} className="apple-button-secondary text-xs px-4 py-2 disabled:opacity-50">
              {kalemYenile.running ? (t ? 'Sayılıyor…' : 'Counting…') : (t ? 'Önizle' : 'Preview')}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setKalemYenile(s => ({ ...s, bekleyen: null, ornek: [], not: null }))} className="apple-button-secondary text-xs px-4 py-2">
                {t ? 'Vazgeç' : 'Cancel'}
              </button>
              <button onClick={() => handleKalemYenile(true)} disabled={kalemYenile.running || kalemYenile.bekleyen === 0}
                className="apple-button-primary text-xs px-4 py-2 disabled:opacity-50">
                {kalemYenile.running
                  ? (t ? 'Yazılıyor…' : 'Writing…')
                  : (t ? `${kalemYenile.bekleyen} Siparişi Yenile` : `Refresh ${kalemYenile.bekleyen} Orders`)}
              </button>
            </div>
          )}
        </div>
        {kalemYenile.bekleyen !== null && (
          <p role="status" className="text-[11px] text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
            {kalemYenile.bekleyen === 0
              ? (t ? 'Yenilenecek sipariş yok.' : 'Nothing to refresh.')
              : `${t ? 'Örnek' : 'Sample'}: ${kalemYenile.ornek.map(o => `${o.orderNumber} (${o.eski} → ${o.yeni} ${t ? 'kalem' : 'lines'})`).join(', ')}${kalemYenile.bekleyen > kalemYenile.ornek.length ? '…' : ''}`}
          </p>
        )}
        {kalemYenile.bekleyen !== null && kalemYenile.not && (
          <p role="status" className="text-[11px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{kalemYenile.not}</p>
        )}
        {kalemYenile.sonuc && <p role="status" className="text-[11px] text-green-700 bg-green-50 rounded-xl px-3 py-2">{kalemYenile.sonuc}</p>}
        {kalemYenile.hata && <p role="alert" className="text-[11px] text-red-700 bg-red-50 rounded-xl px-3 py-2">{kalemYenile.hata}</p>}
      </section>

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
              disabled={tumu.calisiyor}
              title={t ? 'Tüm Mikro verilerini sırayla çeker' : 'Pulls all Mikro data sequentially'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a3a5c] text-white text-xs font-semibold hover:bg-[#16324f] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${tumu.calisiyor ? 'animate-spin' : ''}`} />
              {tumu.calisiyor
                ? (t ? `Çekiliyor: ${tumu.adim ?? '...'}` : `Pulling: ${tumu.adim ?? '...'}`)
                : (t ? 'Tümünü Çek' : 'Pull All')}
            </button>
            <button
              onClick={handleHamSatirTemizle}
              disabled={temizlikRunning || tumu.calisiyor}
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
        {tumu.ozet && (
          <div
            role="status"
            aria-label={t ? 'Tümünü Çek özeti' : 'Pull All summary'}
            className={`mb-4 px-3 py-2 rounded-xl text-xs font-medium ${tumu.ozet.hatalar.length > 0 || tumu.ozet.durduruldu ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}
          >
            {t
              ? `Bitti — ${tumu.ozet.ok} adım tamam${tumu.ozet.hatalar.length > 0 ? `, ${tumu.ozet.hatalar.length} adım hatalı:` : '.'}`
              : `Done — ${tumu.ozet.ok} steps OK${tumu.ozet.hatalar.length > 0 ? `, ${tumu.ozet.hatalar.length} failed:` : '.'}`}
            {/* Arka plan adımının başlatma hatası kartta GÖRÜNMEZ (kart yalnız kendi düğmesinin hatasını tutar) —
                metin burada. Senkron adım hatası hem kartında hem burada (delta bulgu 10). */}
            {tumu.ozet.hatalar.length > 0 && (
              <ul className="mt-1 pl-4 list-disc font-normal space-y-0.5">
                {tumu.ozet.hatalar.map((h, i) => <li key={`${i}-${h.ad}`}><b>{h.ad}</b>: {h.metin}</li>)}
              </ul>
            )}
            {tumu.ozet.durduruldu && (
              <p className="mt-1">
                {tumu.ozet.durduruldu.sebep === 'oturum'
                  ? (t ? 'Oturum değişti — sıra durduruldu.' : 'Session changed — queue stopped.')
                  : (t ? 'Sıra durduruldu.' : 'Queue stopped.')}
                {tumu.ozet.durduruldu.kalan.length > 0 && (
                  <span className="font-normal">
                    {t ? ' Koşturulmayan adımlar: ' : ' Steps not run: '}{tumu.ozet.durduruldu.kalan.join(', ')}
                  </span>
                )}
              </p>
            )}
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
          {extraPullDefs.map(def => def.arkaPlan ? (
            <ArkaPlanIsiKarti
              key={def.key}
              isAdi={mikroIsAdi(def.route)}
              baslik={def.title}
              aciklama={def.desc}
              dugmeMetni={t ? 'Çek' : 'Pull'}
              gorunum={{ icon: <Package className="w-4 h-4 text-[#1a3a5c]" /> }}
              disabled={!status?.configured}
              baslat={() => mikroImportBaslat(def.route)}
              lang={currentLanguage}
            />
          ) : (
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
                <span className="ml-2 text-[11px] font-medium text-gray-400">({syncLog.length} {t ? 'kayıt · son 30' : 'records · last 30'})</span>
              )}
            </span>
          </div>
          {showLog ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showLog && (
          <div className="border-t border-gray-100 overflow-x-auto">
            {syncLogError ? (
              <p className="text-center text-sm text-red-600 py-8">
                {t ? 'Senkronizasyon geçmişi okunamadı: ' : 'Could not read sync history: '}
                <b>{syncLogError}</b>
              </p>
            ) : !gecmisOkunabilir && syncLog.length === 0 ? (
              // 'Göremez' notu yalnız liste BOŞKEN: rol istemci TAHMİNİ (appStore varsayılanı Sales; profil
              // senkronu düşerse güncellenmez) — sunucu kayıt gönderdiyse onlar gizlenmez (hakem 2026-09-25).
              <p className="text-center text-sm text-amber-700 bg-amber-50 py-8 px-4">
                {t
                  ? `Bu rol (${userRole}) senkronizasyon geçmişini göremez — yalnız Admin/Manager okur (rbac.ts). Kayıtlar tutulmaya devam ediyor.`
                  : `This role (${userRole}) cannot read sync history — Admin/Manager only. Records are still being written.`}
              </p>
            ) : syncLog.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">
                {t ? 'Henüz senkronizasyon kaydı yok. (Kayıtlar yalnız Mikro içe/dışa aktarımı çalıştığında oluşur.)' : 'No sync records yet. (Records are only created when a Mikro import/export runs.)'}
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
                        {/* İkiz ölçümü (I2): numara hangi anahtarda dönüyor — kullanıcı bu satırı iletir. */}
                        {Array.isArray(entry.ayrinti?.yanitAnahtarlari) && entry.ayrinti.yanitAnahtarlari.length > 0 && (
                          <span className="block mt-0.5 text-gray-400 break-all">
                            Yanıt alanları: {(entry.ayrinti.yanitAnahtarlari as unknown[]).map(String).join(', ')}
                          </span>
                        )}
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

// ── Kart ekOzet yardımcıları (iş-özel; ArkaPlanIsiKarti genel özeti basar) ────

/** Nesne mi (null değil) — iş dokümanındaki örnek satırlarını cast'siz daraltmak için. */
const kayitMi = (o: unknown): o is Record<string, unknown> => typeof o === 'object' && o !== null;

/** Stok kartına özel: `fiyatliUrun === 0` rehberi. Uyarı DOĞRU ama eskiden ÇIKMAZ SOKAKTI: Mikro stok
 *  kartlarında fiyat zaten hiçbir zaman olmuyor, fiyatlar AYRI bir kaynaktan ("Satış Fiyatları" kartı)
 *  geliyor. Kullanıcı ne yapacağını bilmeden "0 TL" uyarısıyla kalıyordu; çözüm doğrudan yazılır. */
function fiyatRehberi(is: ArkaPlanIsi, t: boolean): React.ReactNode {
  if (is.running || is.fiyatliUrun !== 0) return null;
  return (
    <div className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5">
      ⚠ {t
        ? 'Mikro stok kartlarında fiyat alanı yok — bu normaldir. Fiyatlar ayrı gelir: aşağıdaki '
        : 'Mikro stock cards carry no price field — this is normal. Prices come separately: run '}
      <b>{t ? '"Satış Fiyatları → Çek"' : '"Sales Prices → Pull"'}</b>
      {t
        ? ' adımını çalıştırın, ürünler "0 TL" görünmekten çıkar.'
        : ' below and the "0 TL" display resolves.'}
    </div>
  );
}

/** Miktar kartına özel: `failed` + depo dağılımı mutabakatı (dağılımın toplamı otoriter miktarla tutuyor mu?
 *  Bu, per-depo SQL semantiğinin (sth_tip 0=giriş/1=çıkış) TÜM katalogdaki kanıtıdır — örnek satıra bakmak
 *  yerine her SKU'da kontrol edilir). Alanlar: depoUyusmazlik = dağılım toplamı otoriter miktarla tutmayan
 *  SKU; depoDagilimliUrun = dağılımı YAZILAN ürün = kontrolün gerçek kapsamı (hareket kaydı olmayan ürün hiç
 *  kontrol edilmez, o yüzden "uyuşmazlık 0" tek başına "hepsi doğrulandı" anlamına GELMEZ); depoDevirli =
 *  açılış/devir stoğu hareket defterinde olmadığı için `__devir` kovası eklenen ürün. Sayılar `sonluSayi` ile
 *  (eski sıfır varsayılanı sahte kesinlikti). */
function depoDagilimi(is: ArkaPlanIsi, t: boolean): React.ReactNode {
  const failed = sonluSayi(is.failed);
  const depoDagilimliUrun = sonluSayi(is.depoDagilimliUrun);
  const depoDevirli = sonluSayi(is.depoDevirli);
  const depoUyusmazlik = sonluSayi(is.depoUyusmazlik);
  const ornekler = Array.isArray(is.uyusmazlikOrnek) ? is.uyusmazlikOrnek.slice(0, 3).filter(kayitMi) : [];
  return (
    <>
      {failed !== null && failed > 0 && (
        <p className="text-[11px] text-amber-600">⚠ {failed} {t ? 'SKU okunamadı' : 'SKUs failed'}</p>
      )}
      {!is.running && depoDagilimliUrun !== null && (
        <div className="text-[11px] rounded-xl px-3 py-2 space-y-1 bg-gray-50 text-gray-700">
          {/* KAPSAM önce yazılır: hareket kaydı olmayan ürün hiç kontrol edilmez, o yüzden
              "uyuşmazlık 0" tek başına yanıltıcıdır. */}
          <p>
            📦 {t ? 'Depo dağılımı yazılan ürün' : 'Products with breakdown'}:{' '}
            <b>{depoDagilimliUrun}</b>
            <span className="text-gray-400"> / {sayiMetni(is.total)}</span>
            <span className="text-gray-400">
              {' '}— {t ? 'kalanların stok hareketi yok, kontrol edilmedi'
                      : 'the rest have no stock movements'}
            </span>
          </p>
          {depoDevirli !== null && depoDevirli > 0 && (
            <p className="text-blue-700">
              ↪ {depoDevirli} {t ? 'üründe açılış/devir stoğu hareket defterinde yok — "Devir (depo bilinmiyor)" olarak ayrıldı.'
                                 : 'products have opening stock outside the ledger — shown as "Devir".'}
            </p>
          )}
          {depoUyusmazlik !== null && depoUyusmazlik > 0 && (
            <div className="text-amber-800">
              <p className="font-semibold">
                ⚠ {depoUyusmazlik} {t ? 'üründe defter gerçek stoktan FAZLA — dağılım yazılmadı.'
                                       : 'products: ledger exceeds real stock — breakdown not written.'}
              </p>
              {ornekler.map(o => (
                <p key={String(o.sku)} className="font-mono text-[10px]">
                  {String(o.sku)}: {t ? 'defter' : 'ledger'} {sayiMetni(o.toplam)} ≠ Mikro {sayiMetni(o.beklenen)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </>
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
