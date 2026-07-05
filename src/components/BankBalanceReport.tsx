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
import { Landmark, RefreshCw, Save } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc } from '../lib/dbClient';
import { logFirestoreError, OperationType } from '../utils/firebase';
import type { BankAccount, BankTransaction } from '../types';

interface Props {
  currentLanguage: 'tr' | 'en';
  exchangeRates: Record<string, number> | null;
  toast: (msg: string, type?: string) => void;
}

const FX_FALLBACK: Record<string, number> = { USD: 38, EUR: 41 };

export default function BankBalanceReport({ currentLanguage, exchangeRates, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [openingDraft, setOpeningDraft] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [aSnap, tSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankTransactions')),
      ]);
      setAccounts(aSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
      setTxns(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)));
    } catch (e) {
      logFirestoreError(e as Error, OperationType.LIST, 'bankAccounts');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const rate = (cur: string) => cur === 'TRY' ? 1 : (exchangeRates?.[cur] ?? FX_FALLBACK[cur] ?? 1);

  // Her hesap için: açılış + (asOf tarihine/dahil kadar) hareket toplamı = bakiye (kendi para biriminde).
  const rows = useMemo(() => accounts.map(acc => {
    const opening = Number(acc.openingBalance) || 0;
    const movement = txns
      .filter(t => t.accountId === acc.id && (!t.date || t.date <= asOf) && (!acc.openingDate || !t.date || t.date >= acc.openingDate))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const balance = opening + movement;
    const cur = acc.currency || 'TRY';
    const tryValue = balance * rate(cur);
    return { acc, opening, movement, balance, cur, tryValue };
  }), [accounts, txns, asOf, exchangeRates]);

  const totalTRY = rows.reduce((s, r) => s + r.tryValue, 0);

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
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><Landmark className="w-4 h-4 text-brand" />{tr ? 'Banka Bakiye Durum Raporu' : 'Bank Balance Report'}</h3>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs font-bold text-gray-500">{tr ? 'Tarih itibarıyla' : 'As of'}:</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="apple-input text-sm px-3 py-1.5" />
          <button onClick={() => void load()} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title={tr ? 'Yenile' : 'Refresh'}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
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
                    {fmt(tryValue)}
                    {cur !== 'TRY' && <span className="block text-[9px] text-gray-400 font-normal">@ {rate(cur).toFixed(4)}</span>}
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
          {rows.some(r => r.cur !== 'TRY') && (
            <p className="text-[11px] text-gray-400 mt-2">{tr ? 'Döviz hesaplar güncel TCMB kuruyla TRY\'ye çevrildi. (Geçmiş tarihli kur değerlemesi için o günün kuru gerekir — şu an güncel kur kullanılıyor.)' : 'FX accounts converted at current CBRT rate.'}</p>
          )}
        </div>
      )}
    </div>
  );
}
