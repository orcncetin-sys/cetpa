/**
 * CariEkstrePanel.tsx — Cari Ekstre + Vade Analizi (AR Aging)
 *
 * Pure Firebase query — no Mikro needed.
 * Shows: current/30/60/90/90+ day aging buckets + row-level detail
 * per customer or across all customers.
 *
 * Usage:
 *   <CariEkstrePanel currentLanguage="tr" />                   ← all customers
 *   <CariEkstrePanel currentLanguage="tr" leadId={lead.id} />  ← one customer
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, Timestamp,
} from '../lib/dbClient';
import { db } from '../firebase';
import { authFetch } from '../services/authFetch';
import { FileText, AlertTriangle, CheckCircle2, Clock, TrendingUp, Download } from 'lucide-react';
import { type Order } from '../types';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgingBuckets {
  current: number; // 0-30 days
  d30: number;     // 31-60
  d60: number;     // 61-90
  d90: number;     // 91-120
  over90: number;  // 120+
}

interface AgingRow {
  id: string;
  customerName: string;
  amount: number;
  ageD: number;
  status: string;
  createdAt: string | null;
  leadId?: string;
  raw?: Record<string, unknown>; // raw document data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ageLabel(ageD: number): string {
  if (ageD <= 30)  return '0–30';
  if (ageD <= 60)  return '31–60';
  if (ageD <= 90)  return '61–90';
  if (ageD <= 120) return '91–120';
  return '120+';
}

function ageColor(ageD: number): string {
  if (ageD <= 30)  return 'bg-green-100 text-green-700';
  if (ageD <= 60)  return 'bg-yellow-100 text-yellow-700';
  if (ageD <= 90)  return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-600';
}

function fmt(n: number): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') { const d = new Date(ts); return isNaN(d.getTime()) ? null : d; }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) return new Date((ts as { seconds: number }).seconds * 1000);
  return null;
}

// ── Bucket bar ────────────────────────────────────────────────────────────────

function BucketBar({ buckets, lang }: { buckets: AgingBuckets; lang: string }) {
  const t = lang === 'tr';
  const total = Object.values(buckets).reduce((s, v) => s + v, 0) || 1;
  const items = [
    { label: t ? '0–30 Gün' : '0–30 Days',   value: buckets.current, color: 'bg-green-400' },
    { label: t ? '31–60 Gün' : '31–60 Days',  value: buckets.d30,     color: 'bg-yellow-400' },
    { label: t ? '61–90 Gün' : '61–90 Days',  value: buckets.d60,     color: 'bg-orange-400' },
    { label: t ? '91–120 Gün' : '91–120 Days', value: buckets.d90,    color: 'bg-red-400' },
    { label: t ? '120+ Gün' : '120+ Days',    value: buckets.over90,  color: 'bg-red-700' },
  ];
  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-4 rounded-full overflow-hidden w-full gap-px">
        {items.map((b, i) => {
          const pct = (b.value / total) * 100;
          if (pct < 0.5) return null;
          return <div key={i} className={`${b.color} transition-all`} style={{ width: `${pct}%` }} title={`${b.label}: ₺${fmt(b.value)}`} />;
        })}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-sm flex-shrink-0 ${b.color}`} />
            <div>
              <div className="text-[10px] text-gray-500">{b.label}</div>
              <div className="text-xs font-bold text-gray-800">₺{fmt(b.value)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** cha_evrak_tip → okunur hareket tipi etiketi.
 *  Yalnız kanıtlı türler (Mikro V17 Postman DekontKaydet/FaturaKaydet/Tahsilat
 *  örneklerinden): 63 Fatura, 31 Borç Dekontu, 33 Virman, 34 Tahsilat/Tediye,
 *  57 Cari Virman, 58 Banka Virman, 100 Cari Borç Dekontu, 110 Kasa Virman.
 *  Bilinmeyen tip ham numarayla gösterilir ("Hareket (tip N)") — uydurmak yok. */
function hareketTipiEtiket(chaEvrakTip: unknown): string {
  const n = Number(chaEvrakTip);
  switch (n) {
    case 63:  return 'Fatura';
    case 31:  return 'Borç Dekontu';
    case 33:  return 'Virman Dekontu';
    case 34:  return 'Tahsilat/Tediye';
    case 57:  return 'Cari Virman';
    case 58:  return 'Banka Virman';
    case 100: return 'Cari Borç Dekontu';
    case 110: return 'Kasa Virman';
    default:  return Number.isFinite(n) && n >= 0 ? `Hareket (tip ${n})` : 'Hareket';
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

interface CariEkstrePanelProps {
  currentLanguage?: string;
  leadId?: string;       // if set: show only this customer's data (Cetpa orders modu)
  customerName?: string; // display name for the header
  /** Mikro cari kodu — verilirse ekstre mikroFaturalar'dan (gerçek fatura hareketleri) gelir. */
  cariKod?: string;
  /** cariBalances'tan gelen güncel bakiye — mikroFaturalar tahsilatı içermez, bakiye ayrı gelir. */
  balance?: number;
  /** Sadece GLOBAL modda (leadId/cariKod yokken) kullanılır: tüm carilerin net
   *  pozitif bakiyesi (cariBalanceToplam.ar) — "Toplam Alacak"a additive eklenir.
   *  Bu ekran eskiden salt native orders'tı (bkz. dosya başı yorumu), gerçek iş
   *  hacminin çoğu Mikro'dan geldiğinden hep ₺0'a yakın görünüyordu (2026-08-17
   *  bildirimi). Vade kovaları hâlâ yalnız native orders'tan — Mikro'da vade
   *  tarihi yok, sahte kesinlik üretmemek için oraya karışmıyor. */
  mikroArTotal?: number;
}

export default function CariEkstrePanel({
  currentLanguage = 'tr',
  leadId,
  customerName,
  cariKod,
  balance,
  mikroArTotal,
}: CariEkstrePanelProps) {
  const t = currentLanguage === 'tr';

  const [rows, setRows]       = useState<AgingRow[]>([]);
  const [buckets, setBuckets] = useState<AgingBuckets>({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0 });
  const [loading, setLoading] = useState(true);
  // Gerçek zamanlı hareketlerden hesaplanan bakiye — leads.balance gibi Mikro'yla
  // hiç senkronlanmayan/stale bir prop'a güvenmek yerine (2026-08-13 bildirimi:
  // Müşteri Adayı ekranında Bakiye hep ₺0,00 görünüyordu, oysa aynı cari Cariler
  // sayfasında doğru bakiyeyi gösteriyordu — kaynak farkı: Cariler'de canlı Mikro
  // senkronlu customer.balance kullanılıyor, lead.balance ise hiç güncellenmiyor).
  // Formül doğrulanmış (2026-07-30): eksi = Cetpa borçlu. SUM(cha_tip=0 ? +meblag : -meblag).
  const [computedBalance, setComputedBalance] = useState<number | null>(null);
  const [filter, setFilter]   = useState<'all' | 'overdue'>('all');
  const [sortCol, setSortCol] = useState<'ageD' | 'amount' | 'customerName'>('ageD');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [selectedInvoice, setSelectedInvoice] = useState<MikroFaturaDetayVerisi | null>(null);

  const mikroModu = !!cariKod;

  // ── MİKRO MODU: cari'nin TÜM hesap hareketleri (mikroCariHareketler) ─────────
  // Eskiden mikroFaturalar okunuyordu — o YALNIZ faturaları tutar. Fatura-olmayan
  // hareketi olan cariler (7 MEHMET: sadece masraf; A BALIK) burada BOŞ görünüyordu.
  // Artık mikroCariHareketler okunur (fatura + masraf + dekont + tahsilat + virman;
  // /api/mikro/import/cari-hareket doldurur). Her hareket bir ekstre satırı:
  // tarih + evrak no + tip (Fatura/Masraf/Dekont…) + borç/alacak + tutar.
  //
  // onSnapshot(where(...)) DEĞİL, tek seferlik GET /api/mikro/cari-hareket/:cariKod —
  // dbClient shim'de where() istemcide filtreleniyor (TÜM koleksiyon indirilip
  // tarayıcıda süzülüyor), mikroCariHareketler şirket-geneli olduğundan tek cari
  // ekstresi için ŞİRKETİN TÜM cari hareket geçmişi indiriliyordu — "çok yavaş"
  // şikayetinin sebebi (2026-08-13). Yeni uç filtreyi sunucuda yapıp yalnız
  // eşleşen satırları döner. Bedeli: modal açıkken canlı güncelleme kayboldu
  // (kısa süreli detay ekranı için kabul edilebilir).
  useEffect(() => {
    if (!mikroModu) return;
    let iptal = false;
    setLoading(true);
    authFetch(`/api/mikro/cari-hareket/${encodeURIComponent(cariKod!)}`)
      .then(r => r.json())
      .then((json: { success: boolean; satirlar?: Record<string, unknown>[] }) => {
        if (iptal) return;
        if (!json.success) { setLoading(false); return; }
        const now = Date.now();
        const newBuckets: AgingBuckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
        const newRows: AgingRow[] = [];
        let balanceAcc = 0;
        (json.satirlar ?? []).forEach(x0 => {
          const x = x0 as Record<string, unknown>;
          const dt = toDate(x.cha_tarihi);
          const ageD = dt ? Math.floor((now - dt.getTime()) / 86400000) : 0;
          const amount = Number(x.cha_meblag ?? 0);
          // cha_tip 0 = borç (satış/masraf → cari borçlanır), 1 = alacak (tahsilat/alış).
          const borc = Number(x.cha_tip ?? 0) === 0;
          balanceAcc += borc ? amount : -amount;
          const yon = borc ? (t ? 'Borç' : 'Debit') : (t ? 'Alacak' : 'Credit');
          const tipEtiket = hareketTipiEtiket(x.cha_evrak_tip);
          // Açıklama (cha_aciklama = "yemek masrafı" vb.) = ana etiket; masraf/dekont
          // hareketleri ne olduğuyla görünür (kullanıcı isteği). Yoksa evrak no'ya düş.
          const aciklama = String(x.cha_aciklama ?? '').trim();
          const hizKod = String(x.cha_kasa_hizkod ?? '').trim();
          const finalAciklama = aciklama || (hizKod ? `Hizmet/Masraf Kodu: ${hizKod}` : '');
          const evrakNo = [x.cha_evrakno_seri, x.cha_evrakno_sira].filter(Boolean).join('');
          const anaEtiket = finalAciklama || evrakNo || (customerName ?? '—');
          // Yaşlandırma yalnız BORÇ (alacak/receivable) hareketlerini kovalar — standart
          // AR aging. Alacak (tahsilat/ödeme) "vadesi geçmiş alacak" DEĞİLDİR; bakiyeyi
          // azaltır. Eskiden borç+alacak karışık toplanıyordu → "Vadesi Geçmiş" şişiyordu
          // (code-review bulgusu). Tüm hareketler yine satır olarak listelenir.
          if (borc) {
            if (ageD <= 30)       newBuckets.current += amount;
            else if (ageD <= 60)  newBuckets.d30     += amount;
            else if (ageD <= 90)  newBuckets.d60     += amount;
            else if (ageD <= 120) newBuckets.d90     += amount;
            else                  newBuckets.over90  += amount;
          }
          newRows.push({
            id: String(x.id ?? ''),
            customerName: anaEtiket,
            amount,
            ageD,
            // Tip + yön (+ açıklama ana etikette ise evrak no): "Masraf · Borç · BD-12".
            status: `${tipEtiket} · ${yon}${finalAciklama && evrakNo ? ` · ${evrakNo}` : ''}`,
            createdAt: dt ? dt.toLocaleDateString('tr-TR') : null,
            raw: x,
          });
        });
        setBuckets(newBuckets);
        setRows(newRows);
        setComputedBalance(balanceAcc);
        setLoading(false);
      })
      .catch(() => { if (!iptal) setLoading(false); });
    return () => { iptal = true; };
  }, [mikroModu, cariKod, t, customerName]);

  // ── ORDERS MODU (Cetpa, eski davranış — CRM aging) ──────────────────────────
  useEffect(() => {
    if (mikroModu) return;
    const ordersRef = collection(db, 'orders');
    let q = query(
      ordersRef,
      where('status', 'in', ['Pending', 'Processing', 'Shipped']),
    );
    if (leadId) {
      q = query(
        ordersRef,
        where('leadId', '==', leadId),
        where('status', 'in', ['Pending', 'Processing', 'Shipped']),
      );
    }
    const unsub = onSnapshot(q, snap => {
      const now = Date.now();
      const newBuckets: AgingBuckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
      const newRows: AgingRow[] = [];

      snap.docs.forEach(d => {
        const o = d.data() as Order & { createdAt?: unknown; leadId?: string };
        const dt = toDate(o.createdAt);
        const ageD = dt ? Math.floor((now - dt.getTime()) / 86400000) : 0;
        const amount = Number(o.totalPrice ?? o.totalAmount ?? 0);

        if (ageD <= 30)       newBuckets.current += amount;
        else if (ageD <= 60)  newBuckets.d30     += amount;
        else if (ageD <= 90)  newBuckets.d60     += amount;
        else if (ageD <= 120) newBuckets.d90     += amount;
        else                  newBuckets.over90  += amount;

        newRows.push({
          id: d.id,
          customerName: o.customerName || '—',
          amount,
          ageD,
          status: o.status,
          createdAt: dt ? dt.toLocaleDateString('tr-TR') : null,
          leadId: o.leadId,
        });
      });

      setBuckets(newBuckets);
      setRows(newRows);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [mikroModu, leadId]);

  // ── Derived ────────────────────────────────────────────────────────────────
  // Global modda (ne leadId ne cariKod) mikroArTotal additive eklenir — bkz.
  // CariEkstrePanelProps.mikroArTotal yorumu.
  const totalAR = Object.values(buckets).reduce((s, v) => s + v, 0) + (!mikroModu && !leadId ? (mikroArTotal ?? 0) : 0);
  const overdueAR = buckets.d30 + buckets.d60 + buckets.d90 + buckets.over90;

  const displayed = [...rows]
    .filter(r => filter === 'all' || r.ageD > 30)
    .sort((a, b) => {
      const va = a[sortCol]; const vb = b[sortCol];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortCol(col); setSortDir(-1); }
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const header = ['Müşteri', 'Tutar (TRY)', 'Vade (Gün)', 'Durum', 'Tarih'];
    const csvRows = displayed.map(r => [r.customerName, r.amount.toFixed(2), r.ageD, r.status, r.createdAt ?? ''].map(v => `"${v}"`).join(','));
    const csv = [header.join(','), ...csvRows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'vade-analizi.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          <h3 className="font-bold text-sm text-gray-900">
            {customerName
              ? `${customerName} — ${t ? 'Cari Ekstre' : 'Account Statement'}`
              : (t ? 'Vade Analizi (AR Aging)' : 'AR Aging Report')}
          </h3>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors">
          <Download className="w-3.5 h-3.5" />CSV
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <div className="text-[10px] text-blue-500 font-bold uppercase">{mikroModu ? (t ? 'Toplam Borç' : 'Total Debit') : (t ? 'Toplam Alacak' : 'Total AR')}</div>
          <div className="text-base font-bold text-blue-700">₺{fmt(totalAR)}</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${overdueAR > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className={`text-[10px] font-bold uppercase ${overdueAR > 0 ? 'text-red-500' : 'text-green-500'}`}>{t ? 'Vadesi Geçmiş' : 'Overdue'}</div>
          <div className={`text-base font-bold ${overdueAR > 0 ? 'text-red-700' : 'text-green-700'}`}>₺{fmt(overdueAR)}</div>
        </div>
        {mikroModu && (computedBalance !== null || balance !== undefined) ? (() => {
          // Bakiye: eksi = Cetpa borçlu (yeşil), artı = cari borçlu (kırmızı).
          // computedBalance TERCİH EDİLİR — aynı ekranda gösterilen hareketlerden
          // canlı hesaplanır, aksi halde `balance` prop'una düşülür (ör. Müşteri
          // Adayı ekranında lead.balance Mikro'yla hiç senkronlanmadığından hep 0
          // görünüyordu — 2026-08-13 bildirimi).
          const bal = computedBalance ?? balance ?? 0;
          return (
            <div className={`rounded-xl p-3 text-center ${bal < 0 ? 'bg-green-50' : bal > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
              <div className={`text-[10px] font-bold uppercase ${bal < 0 ? 'text-green-500' : bal > 0 ? 'text-red-500' : 'text-gray-500'}`}>{t ? 'Bakiye' : 'Balance'}</div>
              <div className={`text-base font-bold ${bal < 0 ? 'text-green-700' : bal > 0 ? 'text-red-700' : 'text-gray-700'}`}>₺{fmt(Math.abs(bal))}</div>
            </div>
          );
        })() : (
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <div className="text-[10px] text-gray-500 font-bold uppercase">{mikroModu ? (t ? 'Hareket' : 'Entries') : (t ? 'Açık Sipariş' : 'Open Orders')}</div>
            <div className="text-base font-bold text-gray-700">{rows.length}</div>
          </div>
        )}
      </div>

      {/* Aging bar */}
      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />{t ? 'Vade Dağılımı' : 'Aging Distribution'}
          </h4>
          <BucketBar buckets={buckets} lang={currentLanguage} />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex gap-2">
            {(['all', 'overdue'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                  filter === f ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {f === 'all' ? (t ? 'Tümü' : 'All') : (t ? 'Vadesi Geçmiş' : 'Overdue')}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-gray-400">{displayed.length} {t ? 'kayıt' : 'records'}</span>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">{t ? 'Yükleniyor…' : 'Loading…'}</div>
        ) : displayed.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500 font-medium">
              {mikroModu
                ? (t ? 'Bu cariye ait hesap hareketi yok.' : 'No entries for this account.')
                : (!leadId && (mikroArTotal ?? 0) > 0)
                  ? (t ? 'Sipariş bazlı detay yok — üstteki toplam Mikro cari bakiyelerinden.' : 'No order-level detail — total above is from Mikro cari balances.')
                  : (t ? 'Açık alacak yok.' : 'No open receivables.')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {!leadId && (
                    <th
                      onClick={() => handleSort('customerName')}
                      className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] cursor-pointer hover:text-gray-600 select-none"
                    >
                      {mikroModu ? (t ? 'Belge No' : 'Doc No') : (t ? 'Müşteri' : 'Customer')} {sortCol === 'customerName' ? (sortDir === -1 ? '↓' : '↑') : ''}
                    </th>
                  )}
                  <th
                    onClick={() => handleSort('amount')}
                    className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] cursor-pointer hover:text-gray-600 select-none text-right"
                  >
                    {t ? 'Tutar' : 'Amount'} {sortCol === 'amount' ? (sortDir === -1 ? '↓' : '↑') : ''}
                  </th>
                  <th
                    onClick={() => handleSort('ageD')}
                    className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] cursor-pointer hover:text-gray-600 select-none text-center"
                  >
                    {t ? 'Vade (Gün)' : 'Age (Days)'} {sortCol === 'ageD' ? (sortDir === -1 ? '↓' : '↑') : ''}
                  </th>
                  <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-center">{t ? 'Durum' : 'Status'}</th>
                  <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">{t ? 'Tarih' : 'Date'}</th>
                  <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-center">{t ? 'Uyarı' : 'Alert'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map(row => {
                  const isFatura = row.raw && Number(row.raw.cha_evrak_tip) === 63;
                  return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (!isFatura || !row.raw) return;
                      const x = row.raw;
                      const seri = String(x.cha_evrakno_seri ?? '').trim();
                      const sira = x.cha_evrakno_sira;
                      const tutar = Number(x.cha_meblag ?? 0) || 0;
                      const matrah = Number(x.cha_aratoplam ?? 0) || 0;
                      setSelectedInvoice({
                        id: row.id,
                        faturaNo: [seri, sira].filter(v => v !== '' && v != null).join('-'),
                        musteri: customerName ?? '—',
                        cariKod: cariKod ?? '—',
                        tarih: row.createdAt ?? '—',
                        tutar,
                        matrah,
                        kdv: tutar - matrah,
                        oran: null,
                        yon: Number(x.cha_tip ?? 0) === 1 ? 'gelen' : 'giden',
                        uuid: String(x.cha_uuid ?? x.cha_ettn ?? x.uuid ?? '') || undefined,
                      });
                    }}
                    className={`hover:bg-gray-50/50 transition-colors ${isFatura ? 'cursor-pointer' : ''}`}
                    title={isFatura ? (t ? 'Fatura detayını görüntüle' : 'View invoice details') : undefined}
                  >
                    {!leadId && (
                      <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[160px] truncate">{row.customerName}</td>
                    )}
                    <td className="px-4 py-2.5 text-right font-bold text-gray-800">₺{fmt(row.amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ageColor(row.ageD)}`}>
                        {ageLabel(row.ageD)} {t ? 'gün' : 'd'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{row.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{row.createdAt ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {row.ageD > 90
                        ? <span title={t ? 'Kritik gecikme' : 'Critical overdue'}><AlertTriangle className="w-4 h-4 text-red-400 mx-auto" /></span>
                        : row.ageD > 30
                          ? <span title={t ? 'Vadesi geçmiş' : 'Overdue'}><Clock className="w-4 h-4 text-orange-400 mx-auto" /></span>
                          : <CheckCircle2 className="w-4 h-4 text-green-400 mx-auto" />}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <MikroFaturaDetay
          fatura={selectedInvoice}
          currentLanguage={currentLanguage}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}
