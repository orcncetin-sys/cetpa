/**
 * BankBalanceReport.tsx — Banka Bakiye Durum Raporu (Mikro'daki ekranın sade karşılığı).
 *
 * Üç eksiği kapatır:
 *  1) Açılış/devir bakiyesi — her hesap için düzenlenebilir (BankAccount.openingBalance).
 *  2) Tarihsel bakiye — seçilen tarihe kadarki hareketlerin kümülatif toplamı
 *     (açılış + o tarihe/dahil kadar bankTransactions).
 *  3) Döviz kur değerlemesi — USD/EUR hesabın bakiyesini güncel TCMB kuruyla
 *     TRY'ye çevirir (Mikro'nun "Kur hesaplama şekli" karşılığı).
 *
 * Veriyi kendi çeker (bankAccounts + bankTransactions getDocs, firma-filtreli).
 */
import { useEffect, useState, useMemo } from 'react';
import { Landmark, RefreshCw, Save, Bookmark, Trash2, AlertTriangle } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc, addDoc, deleteDoc, serverTimestamp } from '../lib/dbClient';
import { authFetch } from '../services/authFetch';
import { logFirestoreError, OperationType } from '../utils/firebase';
import type { BankAccount, BankTransaction, BankReportPreset } from '../types';

interface CostCenter { id: string; kod: string; ad: string }

interface Props {
  currentLanguage: 'tr' | 'en';
  exchangeRates: Record<string, number> | null;
  toast: (msg: string, type?: string) => void;
}

// FX_FALLBACK KALDIRILDI (2026-08-26, kullanici karari). 2024'ten kalma sabit
// kurlarla (USD 38 / EUR 41) banka bakiye raporu doviz hesaplarini TL'ye
// ceviriyordu — kur beslemesi koptugunda rapor sessizce yanlis rakam basiyordu.
// Yeni kural: uydurma kur YOK. Kuru bulunamayan hesabin TL karsiligi '—'
// gosterilir ve TOPLAMA katilmaz; kac hesabin disarida kaldigi yazilir.
// Kur gelince kendiliginden duzelir.

export default function BankBalanceReport({ currentLanguage, exchangeRates, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [openingDraft, setOpeningDraft] = useState<Record<string, string>>({});
  const [asOfRates, setAsOfRates] = useState<Record<string, number> | null>(null);
  const [rateSource, setRateSource] = useState<string>('');
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [costCenterFilter, setCostCenterFilter] = useState('');
  const [presets, setPresets] = useState<BankReportPreset[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [aSnap, tSnap, ccSnap, prSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankTransactions')),
        getDocs(collection(db, 'maliyetMerkezleri')),
        getDocs(collection(db, 'bankReportPresets')),
      ]);
      setAccounts(aSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
      setTxns(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)));
      setCostCenters(ccSnap.docs.map(d => ({ id: d.id, ...(d.data() as { kod: string; ad: string }) })));
      setPresets(prSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankReportPreset)));
    } catch (e) {
      logFirestoreError(e as Error, OperationType.LIST, 'bankAccounts');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // Seçilen tarihin (asOf) TCMB kurunu doğrudan sunucudan çek — kendi arşivimizi
  // tutmuyoruz; sunucu TCMB tarihsel XML'inden (1996'ya kadar) çeker, hafta
  // sonu/tatilde en yakın iş gününe kayar. asOf değişince yeniden çalışır.
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/exchange-rates/at?date=${asOf}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setAsOfRates(d?.rates && typeof d.rates === 'object' ? d.rates : null); setRateSource(d?.source || ''); } })
      .catch(() => { if (!cancelled) { setAsOfRates(null); setRateSource(''); } });
    return () => { cancelled = true; };
  }, [asOf]);

  // Kayıtlı filtre (preset): mevcut tarih + maliyet merkezi kombinasyonunu sakla/yükle.
  const savePreset = async () => {
    const name = window.prompt(tr ? 'Filtre şablonu adı:' : 'Preset name:');
    if (!name || !name.trim()) return;
    try {
      const ref = await addDoc(collection(db, 'bankReportPresets'), { name: name.trim(), asOf, costCenterId: costCenterFilter || '', createdAt: serverTimestamp() });
      setPresets(p => [...p, { id: ref.id, name: name.trim(), asOf, costCenterId: costCenterFilter || '' }]);
      toast(tr ? 'Filtre kaydedildi.' : 'Preset saved.', 'success');
    } catch { toast(tr ? 'Kaydedilemedi.' : 'Save failed.', 'error'); }
  };
  const applyPreset = (p: BankReportPreset) => {
    if (p.asOf) setAsOf(p.asOf);
    setCostCenterFilter(p.costCenterId || '');
  };
  const deletePreset = async (id: string) => {
    try { await deleteDoc(doc(db, 'bankReportPresets', id)); setPresets(list => list.filter(x => x.id !== id)); }
    catch { /* yok say */ }
  };

  // Seçilen tarihin (asOf) sunucudan gelen TCMB kurunu kullanır; yoksa güncel
  // kura (exchangeRates) düşer. asOfRates useEffect ile asOf değişince yenilenir.
  /** Kur; bulunamazsa `null` (asla uydurmaz). Once secilen tarihin TCMB kuru,
   *  sonra guncel kur denenir. */
  const rate = (cur: string): number | null => {
    if (cur === 'TRY') return 1;
    const tarihli = asOfRates?.[cur];
    if (typeof tarihli === 'number' && isFinite(tarihli) && tarihli > 0) return tarihli;
    const guncel = exchangeRates?.[cur];
    return (typeof guncel === 'number' && isFinite(guncel) && guncel > 0) ? guncel : null;
  };
  // Seçilen tarih için gerçek TCMB tarihsel kuru bulundu mu? ('fallback' ise
  // TCMB'den çekilemedi, güncel kur kullanıldı — nota basar)
  const hasHistoricalRate = !!asOfRates && rateSource !== 'fallback' && rateSource !== '';

  // Her hesap için: açılış + (asOf tarihine/dahil kadar) hareket toplamı = bakiye.
  // Maliyet merkezi filtresi seçiliyse: açılış hariç (merkez-bağımsız), yalnız o
  // merkezin hareketleri gösterilir (o merkezin banka hareket toplamı).
  const rows = useMemo(() => accounts.map(acc => {
    const opening = costCenterFilter ? 0 : (Number(acc.openingBalance) || 0);
    const movement = txns
      .filter(t => t.accountId === acc.id && (!t.date || t.date <= asOf) && (!acc.openingDate || !t.date || t.date >= acc.openingDate)
        && (!costCenterFilter || t.costCenterId === costCenterFilter))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const balance = opening + movement;
    const cur = acc.currency || 'TRY';
    const k = rate(cur);
    // Kur yoksa TL karsiligi BILINMIYOR — 0 yazip toplama katmak da, uydurma
    // kurla carpmak da yanlis olurdu. null: hucre '—', toplam disi.
    const tryValue = k === null ? null : balance * k;
    return { acc, opening, movement, balance, cur, tryValue };
  }), [accounts, txns, asOf, exchangeRates, costCenterFilter]);

  const totalTRY = rows.reduce((s, r) => s + (r.tryValue ?? 0), 0);
  /** TL karsiligi hesaplanamayan hesaplar — toplam EKSIK demektir, yazilmali. */
  const kurYokSatirlar = rows.filter(r => r.tryValue === null);

  const saveOpening = async (acc: BankAccount) => {
    const draft = openingDraft[acc.id];
    if (draft === undefined) return;
    const val = Number(draft.replace(',', '.')) || 0;
    try {
      await updateDoc(doc(db, 'bankAccounts', acc.id), { openingBalance: val, openingDate: acc.openingDate || asOf });
      setOpeningDraft(d => { const n = { ...d }; delete n[acc.id]; return n; });
      setAccounts(list => list.map(a => a.id === acc.id ? { ...a, openingBalance: val, openingDate: a.openingDate || asOf } : a));
      toast(tr ? 'Açılış bakiyesi kaydedildi.' : 'Opening balance saved.', 'success');
    } catch (e) {
      logFirestoreError(e as Error, OperationType.UPDATE, `bankAccounts/${acc.id}`);
      toast(tr ? 'Kaydedilemedi.' : 'Save failed.', 'error');
    }
  };

  const fmt = (n: number, cur = 'TRY') => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur !== 'TRY' ? ` ${cur}` : ' ₺');

  return (
    <div className="apple-card p-5">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><Landmark className="w-4 h-4 text-brand" />{tr ? 'Banka Bakiye Durum Raporu' : 'Bank Balance Report'}</h3>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <label className="text-xs font-bold text-gray-500">{tr ? 'Tarih' : 'Date'}:</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="apple-input text-sm px-3 py-1.5" />
          {costCenters.length > 0 && (
            <select value={costCenterFilter} onChange={e => setCostCenterFilter(e.target.value)} className="apple-input text-sm px-3 py-1.5" title={tr ? 'Maliyet merkezi' : 'Cost center'}>
              <option value="">{tr ? 'Tüm merkezler' : 'All centers'}</option>
              {costCenters.map(c => <option key={c.id} value={c.id}>{c.kod} — {c.ad}</option>)}
            </select>
          )}
          <button onClick={() => void load()} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title={tr ? 'Yenile' : 'Refresh'}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {/* Kayıtlı filtre şablonları */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Bookmark className="w-3.5 h-3.5 text-gray-400" />
        <button onClick={() => void savePreset()} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">{tr ? '+ Filtre Kaydet' : '+ Save Preset'}</button>
        {presets.map(p => (
          <span key={p.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-brand/5 text-brand">
            <button onClick={() => applyPreset(p)} className="font-bold hover:underline">{p.name}</button>
            <button onClick={() => void deletePreset(p.id)} className="text-brand/40 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
        {costCenterFilter && <span className="text-[11px] text-gray-400 ml-1">{tr ? '(sadece seçili merkez hareketleri — açılış hariç)' : '(selected center only)'}</span>}
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">{tr ? 'Banka hesabı yok. Muhasebe → Banka Hesapları bölümünden ekleyin.' : 'No bank accounts. Add them under Accounting → Bank Accounts.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold text-gray-400 uppercase border-b border-gray-100">
                <th className="pb-2 pr-3">{tr ? 'Hesap' : 'Account'}</th>
                <th className="pb-2 pr-3 text-right">{tr ? 'Açılış' : 'Opening'}</th>
                <th className="pb-2 pr-3 text-right">{tr ? 'Hareket' : 'Movement'}</th>
                <th className="pb-2 pr-3 text-right">{tr ? 'Bakiye' : 'Balance'}</th>
                <th className="pb-2 text-right">{tr ? 'TRY Karşılığı' : 'TRY Value'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(({ acc, opening, movement, balance, cur, tryValue }) => (
                <tr key={acc.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium text-gray-800">{acc.bankName}</p>
                    <p className="text-[10px] text-gray-400">{cur}{acc.iban ? ` · ${acc.iban.slice(-4)}` : ''}</p>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number" step="0.01"
                        value={openingDraft[acc.id] ?? String(opening)}
                        onChange={e => setOpeningDraft(d => ({ ...d, [acc.id]: e.target.value }))}
                        className="w-24 bg-gray-50 border-none rounded-lg px-2 py-1 text-xs text-right tabular-nums focus:ring-1 focus:ring-brand"
                      />
                      {openingDraft[acc.id] !== undefined && (
                        <button onClick={() => void saveOpening(acc)} className="p-1 rounded text-emerald-500 hover:bg-emerald-50" title={tr ? 'Kaydet' : 'Save'}><Save className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${movement >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(movement, cur)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-bold">{fmt(balance, cur)}</td>
                  <td className="py-2 text-right tabular-nums font-bold text-gray-900">
                    {tryValue === null ? '—' : fmt(tryValue)}
                    {cur !== 'TRY' && (() => { const k = rate(cur); return (
                      <span className="block text-[9px] text-gray-400 font-normal">
                        {k === null ? (currentLanguage === 'tr' ? 'kur yok' : 'no rate') : `@ ${k.toFixed(4)}`}
                      </span>
                    ); })()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-100">
                <td colSpan={4} className="pt-2 pr-3 text-right text-xs font-bold text-gray-500">{tr ? 'TOPLAM (TRY karşılığı)' : 'TOTAL (TRY value)'}</td>
                <td className="pt-2 text-right tabular-nums font-black text-brand">{fmt(totalTRY)}</td>
              </tr>
            </tfoot>
          </table>
          {kurYokSatirlar.length > 0 && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 mt-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="text-xs leading-relaxed">
                {tr
                  ? `${kurYokSatirlar.length} hesabın (${[...new Set(kurYokSatirlar.map(r => r.cur))].join('/')}) kuru bulunamadı — TL karşılıkları hesaplanamadı ve TOPLAMA DAHİL DEĞİL. Kur geldiğinde otomatik düzelir.`
                  : `Exchange rate missing for ${kurYokSatirlar.length} account(s) (${[...new Set(kurYokSatirlar.map(r => r.cur))].join('/')}) — TRY values unavailable and EXCLUDED from the total. Resolves automatically once rates arrive.`}
              </p>
            </div>
          )}
          {rows.some(r => r.cur !== 'TRY') && (
            <p className="text-[11px] text-gray-400 mt-2">
              {hasHistoricalRate
                ? (tr ? `Döviz hesaplar ${asOf} tarihinin TCMB kuruyla değerlendi.` : `FX accounts valued at CBRT rate for ${asOf}.`)
                : (tr ? 'Bu tarihin TCMB kuru çekilemedi — güncel kur kullanıldı.' : 'CBRT rate for this date unavailable — current rate used.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
