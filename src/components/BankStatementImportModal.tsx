/**
 * BankStatementImportModal.tsx — Türk bankası hesap ekstresi CSV içe aktarma.
 *
 * Akış: Hesap seç → CSV yükle → kolon eşleştir (otomatik algılama) → önizleme →
 * içe aktar. Hareketler `bankTransactions` koleksiyonuna source:'import' ile
 * yazılır (AccountingModule banka hareketleri listesi otomatik gösterir).
 *
 * Türkiye'ye özgü iki kritik nokta:
 *  - Sayı biçimi "1.234,56" (nokta binlik / virgül ondalık) → parseTRNumber
 *  - Tarih "DD.MM.YYYY" veya "DD/MM/YYYY" → ISO (YYYY-MM-DD)
 *
 * Dedup: aynı hesapta (date + amount + description) birebir eşleşen hareket
 * tekrar eklenmez (aynı ekstre iki kez yüklenirse kopya olmaz).
 */
import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import Papa from 'papaparse';
import { X, Upload, Check, AlertCircle, Landmark } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from '../lib/dbClient';
import { logFirestoreError, OperationType } from '../utils/firebase';

interface BankAccountLite { id: string; bankName: string; currency?: string }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage: 'tr' | 'en';
  bankAccounts: BankAccountLite[];
  toast: (msg: string, type?: string) => void;
}

type FieldKey = 'date' | 'description' | 'amount' | 'balance' | 'reference';

// Başlık adı → alan otomatik eşleme sözlüğü (Türk bankaları farklı adlar kullanır).
const HEADER_HINTS: Record<FieldKey, string[]> = {
  date: ['tarih', 'işlem tarihi', 'islem tarihi', 'valör', 'valor', 'date'],
  description: ['açıklama', 'aciklama', 'işlem açıklaması', 'islem aciklamasi', 'detay', 'description'],
  amount: ['tutar', 'işlem tutarı', 'islem tutari', 'miktar', 'amount', 'borç/alacak', 'borc/alacak'],
  balance: ['bakiye', 'kalan', 'işlem sonrası bakiye', 'balance'],
  reference: ['referans', 'fiş no', 'fis no', 'dekont', 'işlem no', 'islem no', 'reference'],
};

/** "1.234,56" → 1234.56 (Türk biçimi). "5.000" → 5000 (binlik), "5,75" → 5.75. */
function parseTRNumber(raw: string): number {
  if (!raw) return 0;
  let s = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (s.includes('.') && s.includes(',')) {
    // Hem . hem , varsa: son gelen ayraç ondalıktır (Türk: 1.234,56 / EN: 1,234.56).
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.'); // sadece virgül → ondalık
  } else if (s.includes('.')) {
    // Sadece nokta: birden fazla nokta VEYA son gruptan sonra tam 3 hane ise
    // binlik ayracı (Türk: 5.000 / 1.234.567), aksi halde ondalık (5.75 / 12.5).
    const afterDot = s.slice(s.lastIndexOf('.') + 1);
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount > 1 || afterDot.length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** "DD.MM.YYYY" / "DD/MM/YYYY" / "YYYY-MM-DD" → "YYYY-MM-DD". */
function parseTRDate(raw: string): string {
  const s = String(raw || '').trim();
  const dm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dm) {
    const d = dm[1].padStart(2, '0'); const m = dm[2].padStart(2, '0');
    let y = dm[3]; if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return s;
}

function autoDetect(headers: string[]): Record<FieldKey, string> {
  const map = {} as Record<FieldKey, string>;
  for (const key of Object.keys(HEADER_HINTS) as FieldKey[]) {
    const hit = headers.find(h => HEADER_HINTS[key].some(hint => h.trim().toLowerCase().includes(hint)));
    map[key] = hit || '';
  }
  return map;
}

export default function BankStatementImportModal({ isOpen, onClose, currentLanguage, bankAccounts, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [accountId, setAccountId] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({ date: '', description: '', amount: '', balance: '', reference: '' });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  const selectedAccount = bankAccounts.find(a => a.id === accountId);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hdrs = (res.meta.fields || []).filter(Boolean);
        setHeaders(hdrs);
        setRows(res.data);
        setMapping(autoDetect(hdrs));
      },
      error: () => toast(tr ? 'CSV okunamadı.' : 'Could not read CSV.', 'error'),
    });
  };

  const preview = useMemo(() => rows.slice(0, 5).map(r => ({
    date: parseTRDate(r[mapping.date] || ''),
    description: (r[mapping.description] || '').trim(),
    amount: parseTRNumber(r[mapping.amount] || ''),
    balance: mapping.balance ? parseTRNumber(r[mapping.balance] || '') : undefined,
  })), [rows, mapping]);

  const canImport = !!accountId && !!mapping.date && !!mapping.amount && rows.length > 0 && !importing;

  const handleImport = async () => {
    if (!selectedAccount) return;
    setImporting(true);
    try {
      // Dedup: bu hesabın mevcut hareketlerini çek → (date|amount|desc) anahtar seti.
      const existingSnap = await getDocs(query(collection(db, 'bankTransactions'), where('accountId', '==', accountId)));
      const seen = new Set<string>();
      for (const d of existingSnap.docs) {
        const x = d.data() as Record<string, unknown>;
        seen.add(`${x.date}|${x.amount}|${String(x.description || '').trim().slice(0, 60)}`);
      }

      let added = 0, skipped = 0;
      for (const r of rows) {
        const date = parseTRDate(r[mapping.date] || '');
        const amount = parseTRNumber(r[mapping.amount] || '');
        const description = (r[mapping.description] || '').trim();
        if (!date || !amount) { skipped++; continue; }
        const key = `${date}|${amount}|${description.slice(0, 60)}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        await addDoc(collection(db, 'bankTransactions'), {
          accountId,
          accountName: selectedAccount.bankName,
          date,
          description,
          amount,
          type: amount >= 0 ? 'credit' : 'debit',
          balance: mapping.balance ? parseTRNumber(r[mapping.balance] || '') : 0,
          currency: selectedAccount.currency || 'TRY',
          reference: mapping.reference ? (r[mapping.reference] || '').trim() : '',
          source: 'import',
          createdAt: serverTimestamp(),
        });
        added++;
      }
      setResult({ added, skipped });
      toast(
        tr ? `${added} hareket eklendi${skipped ? `, ${skipped} atlandı (kopya/geçersiz)` : ''}.`
           : `${added} transactions added${skipped ? `, ${skipped} skipped` : ''}.`,
        'success'
      );
    } catch (e) {
      logFirestoreError(e as Error, OperationType.WRITE, 'bankTransactions');
      toast(tr ? 'İçe aktarma hatası.' : 'Import error.', 'error');
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  const fieldLabels: Record<FieldKey, string> = {
    date: tr ? 'Tarih *' : 'Date *',
    amount: tr ? 'Tutar *' : 'Amount *',
    description: tr ? 'Açıklama' : 'Description',
    balance: tr ? 'Bakiye' : 'Balance',
    reference: tr ? 'Referans' : 'Reference',
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        className="apple-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold flex items-center gap-2"><Landmark className="w-5 h-5 text-brand" />{tr ? 'Banka Ekstresi İçe Aktar' : 'Import Bank Statement'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          {/* 1) Hesap */}
          <div>
            <label className="text-[11px] font-bold text-[#86868B] uppercase mb-1.5 block">{tr ? '1. Banka Hesabı' : '1. Bank Account'}</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className="apple-input w-full">
              <option value="">{tr ? 'Hesap seçin…' : 'Select account…'}</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.bankName}{a.currency ? ` (${a.currency})` : ''}</option>)}
            </select>
            {bankAccounts.length === 0 && <p className="text-[11px] text-amber-600 mt-1">{tr ? 'Önce Muhasebe → Banka Hesapları bölümünden hesap ekleyin.' : 'Add a bank account first under Accounting → Bank Accounts.'}</p>}
          </div>

          {/* 2) CSV */}
          <div>
            <label className="text-[11px] font-bold text-[#86868B] uppercase mb-1.5 block">{tr ? '2. CSV Dosyası' : '2. CSV File'}</label>
            <label className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-semibold text-gray-500 hover:border-brand hover:text-brand cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              {rows.length > 0 ? `${rows.length} ${tr ? 'satır yüklendi' : 'rows loaded'}` : (tr ? 'CSV Seç (bankadan indirdiğiniz ekstre)' : 'Choose CSV (bank statement export)')}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>

          {/* 3) Kolon eşleştirme */}
          {headers.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-[#86868B] uppercase mb-1.5 block">{tr ? '3. Kolon Eşleştirme' : '3. Column Mapping'}</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(fieldLabels) as FieldKey[]).map(key => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0">{fieldLabels[key]}</span>
                    <select value={mapping[key]} onChange={e => setMapping(m => ({ ...m, [key]: e.target.value }))} className="apple-input flex-1 text-xs py-1.5">
                      <option value="">—</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4) Önizleme */}
          {preview.length > 0 && mapping.date && mapping.amount && (
            <div>
              <label className="text-[11px] font-bold text-[#86868B] uppercase mb-1.5 block">{tr ? '4. Önizleme (ilk 5)' : '4. Preview (first 5)'}</label>
              <div className="border border-gray-100 rounded-xl overflow-hidden text-xs">
                <table className="w-full">
                  <thead className="bg-gray-50 text-gray-400"><tr>
                    <th className="px-2 py-1.5 text-left">{tr ? 'Tarih' : 'Date'}</th>
                    <th className="px-2 py-1.5 text-left">{tr ? 'Açıklama' : 'Description'}</th>
                    <th className="px-2 py-1.5 text-right">{tr ? 'Tutar' : 'Amount'}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {preview.map((p, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5 tabular-nums">{p.date}</td>
                        <td className="px-2 py-1.5 truncate max-w-[240px]">{p.description}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${p.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{p.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tr ? 'Pozitif tutar = gelen (alacak), negatif = giden (borç). Aynı hareket iki kez eklenmez.' : 'Positive = incoming, negative = outgoing. Duplicates skipped.'}</p>
            </div>
          )}

          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
              <Check className="w-4 h-4" />{tr ? `${result.added} hareket eklendi, ${result.skipped} atlandı.` : `${result.added} added, ${result.skipped} skipped.`}
            </div>
          )}

          <button onClick={() => void handleImport()} disabled={!canImport} className="apple-button-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40">
            {importing ? '…' : <><Check className="w-4 h-4" />{tr ? 'İçe Aktar' : 'Import'}</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
