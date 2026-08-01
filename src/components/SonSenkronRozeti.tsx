/**
 * SonSenkronRozeti.tsx — Mikro verisinin ne kadar taze olduğunu dashboard'da gösterir.
 *
 * 2026-07-31: Gece senkronu (MIKRO_CRON_SYNC, 03:20) devreye alındı; kullanıcı
 * artık ayarlara girip elle çekmiyor. Ama otomatik bir işin SESSİZCE durması
 * mümkün — bugün tam olarak bu yaşandı (pg-boss hata döngüsü aylarca sessiz
 * kaldı, uyarı e-postası hiç gitmedi). Verinin tazeliği kullanıcının her gün
 * gördüğü yerde durmalı ki bozulduğunda fark edilsin.
 *
 * Kaynak: `syncLog` koleksiyonunun en yeni kaydı. Tüm import'lar (SQL listeleri,
 * cari, stok miktarı, bakiye, KDV, mizan) oraya yazıyor.
 *
 * Eşikler: <6 sa taze (yeşil) · <36 sa normal (gri) · üstü BAYAT (kehribar).
 * 36 saat, gece koşusunun bir kez kaçırılmasına tolerans tanır; iki gece üst
 * üste kaçarsa uyarır.
 */
import { useEffect, useState } from 'react';
import { History, AlertTriangle } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot } from '../lib/dbClient';

interface Props {
  currentLanguage: string;
  /** Tıklanınca ERP Hub'a git (opsiyonel). */
  onNavigate?: () => void;
}

function zamanFarki(ms: number, tr: boolean): string {
  const dk = Math.floor(ms / 60000);
  if (dk < 1)  return tr ? 'az önce' : 'just now';
  if (dk < 60) return tr ? `${dk} dk önce` : `${dk} min ago`;
  const sa = Math.floor(dk / 60);
  if (sa < 24) return tr ? `${sa} sa önce` : `${sa}h ago`;
  const gun = Math.floor(sa / 24);
  return tr ? `${gun} gün önce` : `${gun}d ago`;
}

/** Firestore/PG timestamp veya ISO string → ms. Çözülemezse null. */
function zamanMs(v: unknown): number | null {
  if (!v) return null;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') { try { return t.toDate().getTime(); } catch { /* düş */ } }
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export default function SonSenkronRozeti({ currentLanguage, onNavigate }: Props) {
  const tr = currentLanguage === 'tr';
  const [enSon, setEnSon] = useState<{ ms: number; islem: string; basarili: boolean } | null>(null);
  const [yuklendi, setYuklendi] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'syncLog'), snap => {
      let best: { ms: number; islem: string; basarili: boolean } | null = null;
      for (const d of snap.docs) {
        const x = d.data() as Record<string, unknown>;
        const ms = zamanMs(x.timestamp);
        if (ms === null) continue;
        if (!best || ms > best.ms) {
          best = { ms, islem: String(x.operation ?? '—'), basarili: x.success !== false };
        }
      }
      setEnSon(best);
      setYuklendi(true);
    }, () => setYuklendi(true));
    return unsub;
  }, []);

  // Veri gelene kadar hiçbir şey gösterme — "senkron yok" demek yanıltıcı olur.
  if (!yuklendi) return null;

  if (!enSon) {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
        <History className="w-3.5 h-3.5" />
        {tr ? 'Henüz senkron yok' : 'No sync yet'}
      </div>
    );
  }

  const yas = Date.now() - enSon.ms;
  const saat = yas / 3600_000;
  const bayat = saat >= 36;
  const taze  = saat < 6;

  const renk = !enSon.basarili || bayat
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : taze
      ? 'bg-green-50 text-green-700 border-green-200'
      : 'bg-gray-100 text-gray-600 border-gray-200';

  return (
    <button
      onClick={onNavigate}
      title={
        (tr ? 'Son işlem: ' : 'Last operation: ') + enSon.islem +
        (bayat ? (tr ? ' — gece senkronu çalışmamış olabilir' : ' — nightly sync may have failed') : '')
      }
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${renk} ${onNavigate ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
    >
      {bayat || !enSon.basarili ? <AlertTriangle className="w-3.5 h-3.5" /> : <History className="w-3.5 h-3.5" />}
      <span>{tr ? 'Mikro senkron: ' : 'Mikro sync: '}{zamanFarki(yas, tr)}</span>
      {bayat && <span className="font-bold">{tr ? '· BAYAT' : '· STALE'}</span>}
    </button>
  );
}
