import React, { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Calendar, CheckCircle2, AlertTriangle, Clock, RefreshCw, Plus } from 'lucide-react';

interface VergiDeadline {
  id: string;
  vergiTuru: string;
  sonTarih: string;
  donem: string;
  durum: 'Yapılacak' | 'Tamamlandı' | 'Gecikmiş';
  sorumlu: string;
  tahminiTutar?: number;
  notlar?: string;
  createdAt?: unknown;
}

const RECURRING_TEMPLATES = [
  { vergiTuru: 'KDV Beyannamesi', gunOfMonth: 26, monthly: true },
  { vergiTuru: 'Muhtasar ve Prim Hizmet Beyannamesi', gunOfMonth: 26, monthly: true },
  { vergiTuru: 'Damga Vergisi', gunOfMonth: 26, monthly: true },
  { vergiTuru: 'SGK Bildirimi', gunOfMonth: 23, monthly: true },
  { vergiTuru: 'Ba-Bs Formu', gunOfMonth: 31, monthly: true },
];

function generateDeadlines(year: number): Omit<VergiDeadline, 'id' | 'createdAt'>[] {
  const result: Omit<VergiDeadline, 'id' | 'createdAt'>[] = [];
  for (let month = 1; month <= 12; month++) {
    RECURRING_TEMPLATES.forEach(t => {
      const lastDay = new Date(year, month, 0).getDate();
      const day = Math.min(t.gunOfMonth, lastDay);
      const sonTarih = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const donem = `${year}/${String(month).padStart(2,'0')}`;
      result.push({ vergiTuru: t.vergiTuru, sonTarih, donem, durum: 'Yapılacak', sorumlu: 'Mali Müşavir' });
    });
  }
  // Quarterly: Geçici Vergi
  [{ ay: 5, gun: 17 }, { ay: 8, gun: 17 }, { ay: 11, gun: 17 }, { ay: 2, gun: 17, nextYear: true }].forEach(q => {
    const y = q.nextYear ? year + 1 : year;
    result.push({ vergiTuru: 'Geçici Vergi', sonTarih: `${y}-${String(q.ay).padStart(2,'0')}-${String(q.gun).padStart(2,'0')}`, donem: `${year} Q`, durum: 'Yapılacak', sorumlu: 'Mali Müşavir' });
  });
  // Annual: Kurumlar Vergisi
  result.push({ vergiTuru: 'Kurumlar Vergisi', sonTarih: `${year + 1}-04-30`, donem: `${year} Yıllık`, durum: 'Yapılacak', sorumlu: 'Mali Müşavir' });
  return result.sort((a, b) => a.sonTarih.localeCompare(b.sonTarih));
}

export default function VergiTakvimi({ currentLanguage, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const tr = currentLanguage === 'tr';
  const [deadlines, setDeadlines] = useState<VergiDeadline[]>([]);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'late' | 'done'>('upcoming');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'vergiTakvimi'), orderBy('sonTarih')), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as VergiDeadline));
      // Auto-mark overdue
      const today = new Date().toISOString().slice(0, 10);
      const updated = data.map(d => d.durum === 'Yapılacak' && d.sonTarih < today ? { ...d, durum: 'Gecikmiş' as const } : d);
      setDeadlines(updated);
    });
    return () => unsub();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const upcoming = deadlines.filter(d => d.durum === 'Yapılacak' && d.sonTarih >= today && d.sonTarih <= in30Days);
  const late = deadlines.filter(d => d.durum === 'Gecikmiş' || (d.durum === 'Yapılacak' && d.sonTarih < today));
  const done = deadlines.filter(d => d.durum === 'Tamamlandı');

  const filtered = filter === 'upcoming' ? deadlines.filter(d => d.sonTarih >= today && d.sonTarih <= in30Days && d.durum !== 'Tamamlandı')
    : filter === 'late' ? late
    : filter === 'done' ? done
    : deadlines;

  const markDone = async (id: string) => {
    await updateDoc(doc(db, 'vergiTakvimi', id), { durum: 'Tamamlandı' });
  };

  const generateCalendar = async () => {
    setIsGenerating(true);
    try {
      const year = new Date().getFullYear();
      const toGenerate = generateDeadlines(year);
      const existing = await getDocs(collection(db, 'vergiTakvimi'));
      if (existing.size === 0) {
        for (const d of toGenerate) {
          await addDoc(collection(db, 'vergiTakvimi'), { ...d, createdAt: serverTimestamp() });
        }
      }
    } finally { setIsGenerating(false); }
  };

  const getDaysBadge = (sonTarih: string, durum: string) => {
    if (durum === 'Tamamlandı') return { label: tr ? 'Tamamlandı' : 'Done', cls: 'bg-green-100 text-green-700' };
    const diffMs = new Date(sonTarih).getTime() - Date.now();
    const days = Math.ceil(diffMs / 86400000);
    if (days < 0) return { label: tr ? `${Math.abs(days)}g gecikmiş` : `${Math.abs(days)}d overdue`, cls: 'bg-red-100 text-red-700' };
    if (days === 0) return { label: tr ? 'Bugün!' : 'Today!', cls: 'bg-red-100 text-red-700' };
    if (days <= 7) return { label: `${days}g`, cls: 'bg-orange-100 text-orange-700' };
    if (days <= 30) return { label: `${days}g`, cls: 'bg-amber-100 text-amber-700' };
    return { label: `${days}g`, cls: 'bg-blue-100 text-blue-600' };
  };

  const vergiColors: Record<string, string> = {
    'KDV Beyannamesi': 'bg-blue-50 border-l-blue-400',
    'Muhtasar ve Prim Hizmet Beyannamesi': 'bg-purple-50 border-l-purple-400',
    'Damga Vergisi': 'bg-amber-50 border-l-amber-400',
    'SGK Bildirimi': 'bg-teal-50 border-l-teal-400',
    'Ba-Bs Formu': 'bg-indigo-50 border-l-indigo-400',
    'Geçici Vergi': 'bg-orange-50 border-l-orange-400',
    'Kurumlar Vergisi': 'bg-red-50 border-l-red-400',
  };

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: tr ? 'Bu Ay Yaklaşan' : 'Due This Month', val: upcoming.length, icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: tr ? 'Geciken' : 'Overdue', val: late.length, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: tr ? 'Tamamlanan' : 'Completed', val: done.length, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
          { label: tr ? 'Toplam Kayıt' : 'Total Records', val: deadlines.length, icon: Clock, color: 'text-gray-600', bg: 'bg-gray-50' },
        ].map(k => (
          <div key={k.label} className={`apple-card flex items-center gap-3 p-4 ${k.bg}`}>
            <k.icon className={`w-5 h-5 flex-shrink-0 ${k.color}`} />
            <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold ${k.color}`}>{k.val}</p></div>
          </div>
        ))}
      </div>

      {/* Late alerts banner */}
      {late.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-red-800">{late.length} {tr ? 'beyanname/ödeme gecikmiş!' : 'declaration/payment overdue!'}</p>
        </div>
      )}

      <div className="apple-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {[
              { id: 'upcoming', label: tr ? 'Yaklaşan (30g)' : 'Upcoming (30d)' },
              { id: 'late', label: tr ? 'Geciken' : 'Overdue' },
              { id: 'done', label: tr ? 'Tamamlanan' : 'Done' },
              { id: 'all', label: tr ? 'Tümü' : 'All' },
            ].map(t => (
              <button key={t.id} onClick={() => setFilter(t.id as typeof filter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {isAuthenticated && (
            <button onClick={generateCalendar} disabled={isGenerating} className="apple-button-secondary flex items-center gap-2 text-sm">
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              {tr ? 'Takvimi Oluştur' : 'Generate Calendar'}
            </button>
          )}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <Calendar className="w-12 h-12 text-gray-200 mx-auto" />
            <p className="text-gray-400 text-sm">{tr ? '"Takvimi Oluştur" ile otomatik vergi takvimini yükleyin' : 'Click "Generate Calendar" to auto-load tax deadlines'}</p>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map(d => {
            const badge = getDaysBadge(d.sonTarih, d.durum);
            const colorCls = vergiColors[d.vergiTuru] ?? 'bg-gray-50 border-l-gray-300';
            return (
              <div key={d.id} className={`flex items-center justify-between p-3 rounded-xl border border-l-4 ${colorCls}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900 text-sm">{d.vergiTuru}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {tr ? 'Dönem:' : 'Period:'} {d.donem} &nbsp;•&nbsp;
                    {tr ? 'Son Tarih:' : 'Deadline:'} {new Date(d.sonTarih).toLocaleDateString('tr-TR')} &nbsp;•&nbsp;
                    {d.sorumlu}
                  </p>
                </div>
                {isAuthenticated && d.durum !== 'Tamamlandı' && (
                  <button onClick={() => markDone(d.id)}
                    className="ml-3 flex items-center gap-1 text-xs font-semibold text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-full transition-colors flex-shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {tr ? 'Tamamlandı' : 'Mark Done'}
                  </button>
                )}
                {d.durum === 'Tamamlandı' && (
                  <span className="ml-3 flex items-center gap-1 text-xs font-semibold text-green-600">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {tr ? 'Tamam' : 'Done'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
